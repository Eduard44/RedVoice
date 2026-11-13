/**
 * Clip export for video timelines: any PCM or float WAV the engine returns is
 * resampled to 48 kHz and written as 24-bit PCM, the format DaVinci Resolve
 * and most editors use, so the timeline does no conversion of its own.
 */

export const EXPORT_SAMPLE_RATE = 48_000;
export const EXPORT_BITS = 24;

export interface DecodedWav {
  sampleRate: number;
  /** One Float32Array per channel, samples in -1..1. */
  channels: Float32Array[];
}

function chunkId(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Reads a RIFF/WAVE file with 16-, 24- or 32-bit PCM, or 32-bit float samples. */
export function decodeWav(bytes: ArrayBuffer): DecodedWav {
  const view = new DataView(bytes);
  if (bytes.byteLength < 12 || chunkId(view, 0) !== 'RIFF' || chunkId(view, 8) !== 'WAVE')
    throw new Error('Not a WAV file');
  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: { offset: number; length: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = chunkId(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      data = { offset: body, length: Math.min(size, bytes.byteLength - body) };
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!data || !channelCount || !sampleRate) throw new Error('WAV file has no audio');
  const isFloat = format === 3 && bits === 32;
  if (!isFloat && !(format === 1 && (bits === 16 || bits === 24 || bits === 32)))
    throw new Error(`Unsupported WAV format (${format}, ${bits}-bit)`);
  const width = bits / 8;
  const frames = Math.floor(data.length / (width * channelCount));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const at = data.offset + (frame * channelCount + channel) * width;
      let value: number;
      if (isFloat) value = view.getFloat32(at, true);
      else if (bits === 16) value = view.getInt16(at, true) / 32768;
      else if (bits === 24) {
        const raw =
          view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
        value = (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608;
      } else value = view.getInt32(at, true) / 2147483648;
      channels[channel]![frame] = value;
    }
  }
  return { sampleRate, channels };
}

/** Kaiser-windowed sinc taps on each side of a sample; 32 keeps aliasing far below audibility. */
const HALF_TAPS = 32;
const KAISER_BETA = 8.6;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
}

/** Kaiser window over |position| 0..1, sampled finely enough to interpolate. */
const WINDOW_STEPS = 4096;
let windowTable: Float32Array | null = null;
function kaiserTable(): Float32Array {
  if (windowTable) return windowTable;
  const norm = besselI0(KAISER_BETA);
  windowTable = new Float32Array(WINDOW_STEPS + 2);
  for (let i = 0; i <= WINDOW_STEPS; i++) {
    const position = i / WINDOW_STEPS;
    windowTable[i] = besselI0(KAISER_BETA * Math.sqrt(1 - position * position)) / norm;
  }
  return windowTable;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Band-limited resampling; a matching rate returns a copy unchanged.
 * Integer rates repeat the same fractional offsets, so the normalised filter
 * for each offset (phase) is built once and reused for every output sample.
 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const table = kaiserTable();
  const divisor = gcd(from, to);
  const up = to / divisor;
  const down = from / divisor;
  const length = Math.round((input.length * to) / from);
  const output = new Float32Array(length);
  // Cut off below the lower Nyquist frequency so downsampling cannot alias.
  const cutoff = Math.min(1, to / from) * 0.97;
  const reach = Math.ceil(HALF_TAPS / cutoff);
  const width = reach * 2 + 1;
  const phases = new Float32Array(up * width);
  for (let phase = 0; phase < up; phase++) {
    const fraction = phase / up;
    for (let k = 0; k < width; k++) {
      const t = (k - reach - fraction) * cutoff;
      const position = Math.abs(t) / HALF_TAPS;
      if (position >= 1) continue;
      const scaled = position * WINDOW_STEPS;
      const index = scaled | 0;
      const window = table[index]! + (table[index + 1]! - table[index]!) * (scaled - index);
      phases[phase * width + k] = (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * window;
    }
  }
  for (let i = 0; i < length; i++) {
    const numerator = i * down;
    const base = Math.floor(numerator / up);
    const offset = (numerator % up) * width;
    let sum = 0;
    let weights = 0;
    for (let k = 0; k < width; k++) {
      const j = base + k - reach;
      if (j < 0 || j >= input.length) continue;
      const weight = phases[offset + k]!;
      sum += input[j]! * weight;
      weights += weight;
    }
    // Normalise by the summed weights so the edges keep their level.
    output[i] = weights ? sum / weights : 0;
  }
  return output;
}

/** Writes interleaved 24-bit little-endian PCM, with TPDF dither below the 24-bit step. */
export function encodeWav24(
  channels: Float32Array[],
  sampleRate: number,
  random = Math.random,
): Uint8Array {
  const channelCount = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * channelCount * 3;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 3, true);
  view.setUint16(32, channelCount * 3, true);
  view.setUint16(34, 24, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const dither = (random() - random()) / 8388608;
      const sample = Math.max(-1, Math.min(1, channels[channel]![frame]! + dither));
      const value = Math.max(-8388608, Math.min(8388607, Math.round(sample * 8388608)));
      out[at++] = value & 0xff;
      out[at++] = (value >> 8) & 0xff;
      out[at++] = (value >> 16) & 0xff;
    }
  }
  return out;
}

/** Any supported WAV in, 48 kHz 24-bit WAV out. */
export function toTimelineWav(bytes: ArrayBuffer): Uint8Array {
  const decoded = decodeWav(bytes);
  const channels = decoded.channels.map((channel) =>
    resample(channel, decoded.sampleRate, EXPORT_SAMPLE_RATE),
  );
  return encodeWav24(channels, EXPORT_SAMPLE_RATE);
}
