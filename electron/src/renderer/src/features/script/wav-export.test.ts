import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav24, resample, toTimelineWav } from './wav-export';

/** A mono 16-bit PCM WAV, the format the engines return by default. */
function wav16(samples: number[], sampleRate: number): ArrayBuffer {
  const data = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + data));
  const text = (at: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(sample * 32767), true));
  return view.buffer;
}

const sine = (frequency: number, rate: number, seconds: number) =>
  Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * frequency * i) / rate),
  );

describe('clip export', () => {
  it('turns a 24 kHz 16-bit take into a 48 kHz 24-bit WAV of the same length', () => {
    const out = toTimelineWav(wav16(sine(440, 24_000, 0.5), 24_000));
    const decoded = decodeWav(out.buffer as ArrayBuffer);
    const view = new DataView(out.buffer);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(24);
    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.channels[0]!.length).toBe(24_000);
  });

  it('keeps a tone at its pitch and level when doubling the rate', () => {
    const input = Float32Array.from(sine(1000, 24_000, 0.2));
    const output = resample(input, 24_000, 48_000);
    // Compare a stretch away from the edges with the ideal 48 kHz tone.
    let error = 0;
    for (let i = 1000; i < 8000; i++)
      error = Math.max(
        error,
        Math.abs(output[i]! - 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48_000)),
      );
    expect(error).toBeLessThan(0.002);
  });

  it('filters content above the new Nyquist frequency when downsampling', () => {
    // 20 kHz is above 12 kHz Nyquist at 24 kHz: it must not fold back into the audio.
    const output = resample(Float32Array.from(sine(20_000, 48_000, 0.2)), 48_000, 24_000);
    const middle = output.slice(500, 4000);
    expect(Math.max(...Array.from(middle, Math.abs))).toBeLessThan(0.01);
  });

  it('round-trips 24-bit samples within one dither step', () => {
    const samples = Float32Array.from([0, 0.25, -0.25, 0.999, -1]);
    const decoded = decodeWav(encodeWav24([samples], 48_000, () => 0.5).buffer as ArrayBuffer);
    decoded.channels[0]!.forEach((value, i) => expect(value).toBeCloseTo(samples[i]!, 5));
  });

  it('rejects files that are not WAV audio', () => {
    expect(() =>
      decodeWav(new TextEncoder().encode('not audio at all').buffer as ArrayBuffer),
    ).toThrow('Not a WAV');
  });
});
