import { parseSrt } from '@shared/utils/importStory';

/** One subtitle: its time slot in seconds and the words to speak. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

const TIME = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})`;
const TIMING = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}`);

function seconds(hours: string | undefined, minutes: string, secs: string, fraction: string) {
  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(secs) +
    Number(fraction.padEnd(3, '0')) / 1000
  );
}

/**
 * Reads SRT or WebVTT cues with their timings. The words are cleaned by the
 * same parser Stories uses, so formatting tags and cue settings are dropped
 * the same way; cues without speech or with a broken timing are skipped.
 */
export function parseSubtitles(content: string): Cue[] {
  const normalized = String(content || '').replace(/\r\n?/g, '\n');
  const webvtt = /^﻿?WEBVTT(?:[ \t]|$)/m.test(normalized.split('\n', 1)[0] ?? '');
  const cues: Cue[] = [];
  for (const block of normalized.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => TIMING.test(line));
    if (at < 0) continue;
    const match = TIMING.exec(lines[at]!)!;
    const start = seconds(match[1], match[2]!, match[3]!, match[4]!);
    const end = seconds(match[5], match[6]!, match[7]!, match[8]!);
    if (!(end > start)) continue;
    const body = lines.slice(at + 1).join('\n');
    // One cue run through the shared cleaner: the same tags and markup rules.
    const text = parseSrt(`${webvtt ? 'WEBVTT\n\n' : ''}1\n${lines[at]!.trim()}\n${body}`).trim();
    if (text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function stamp(value: number): string {
  const total = Math.max(0, Math.round(value * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(h)}:${two(m)}:${two(s)},${String(ms).padStart(3, '0')}`;
}

/** Writes cues as SRT, numbered 1, 2, 3… in the order given. */
export function formatSrt(cues: Cue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`)
    .join('\n');
}

/** `0:03.20` style, short enough for a line label. */
export function shortTime(value: number): string {
  const total = Math.max(0, Math.round(value * 100));
  const hundredths = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return `${m}:${String(s).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}
