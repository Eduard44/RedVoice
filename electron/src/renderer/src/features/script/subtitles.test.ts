import { describe, expect, it } from 'vitest';
import { formatSrt, parseSubtitles, shortTime } from './subtitles';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Every great edit starts
with a single frame.

2
00:00:04,250 --> 00:00:06,000
<i>Cut on the beat.</i>

3
00:00:07,000 --> 00:00:08,000
`;

describe('parseSubtitles', () => {
  it('reads timings and joins multi-line cue text', () => {
    expect(parseSubtitles(SRT)).toEqual([
      { start: 1, end: 3.5, text: 'Every great edit starts with a single frame.' },
      { start: 4.25, end: 6, text: 'Cut on the beat.' },
    ]);
  });

  it('reads WebVTT, including hour-less timings and cue settings', () => {
    const vtt = `WEBVTT

intro
00:01.500 --> 00:03.000 align:start
Hello there.

NOTE a private comment

01:00:00.000 --> 01:00:02.250
An hour in.
`;
    expect(parseSubtitles(vtt)).toEqual([
      { start: 1.5, end: 3, text: 'Hello there.' },
      { start: 3600, end: 3602.25, text: 'An hour in.' },
    ]);
  });

  it('handles Windows line endings and skips broken or empty timings', () => {
    const messy =
      '1\r\n00:00:02,000 --> 00:00:01,000\r\nBackwards\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nGood\r\n';
    expect(parseSubtitles(messy)).toEqual([{ start: 3, end: 4, text: 'Good' }]);
    expect(parseSubtitles('just some text')).toEqual([]);
  });
});

describe('formatSrt', () => {
  it('writes numbered cues with SRT timestamps', () => {
    expect(
      formatSrt([
        { start: 1, end: 3.5, text: 'One' },
        { start: 3725.25, end: 3726, text: 'Two' },
      ]),
    ).toBe('1\n00:00:01,000 --> 00:00:03,500\nOne\n\n2\n01:02:05,250 --> 01:02:06,000\nTwo\n');
  });

  it('round-trips through the parser', () => {
    const cues = parseSubtitles(SRT);
    expect(parseSubtitles(formatSrt(cues))).toEqual(cues);
  });
});

it('formats short time labels', () => {
  expect(shortTime(3.2)).toBe('0:03.20');
  expect(shortTime(125.456)).toBe('2:05.46');
});
