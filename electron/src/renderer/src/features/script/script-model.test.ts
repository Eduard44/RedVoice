import { describe, expect, it } from 'vitest';
import {
  addTake,
  chooseTake,
  chosenTake,
  clearTakes,
  DEFAULT_TAKES,
  emptyDraft,
  exportPlan,
  exportSubtitles,
  linesFromCues,
  overrun,
  removeTiming,
  slotSeconds,
  parseDraft,
  randomSeed,
  removeTake,
  resplit,
  splitScript,
  takeFileName,
  type ScriptDraft,
} from './script-model';

const take = (id: string) => ({ id, audioPath: `${id}.wav`, seed: 1, durationSeconds: 2 });
const draftWith = (source: string): ScriptDraft => resplit(emptyDraft(), source);

describe('script splitting', () => {
  it('makes each non-empty line a clip by default', () => {
    expect(splitScript('Hello there.\n\n  Second line \r\nThird', 'lines')).toEqual([
      'Hello there.',
      'Second line',
      'Third',
    ]);
  });

  it('can split by sentence instead', () => {
    expect(splitScript('One sentence. Another one! A third?', 'sentences').length).toBeGreaterThan(
      0,
    );
  });

  it('keeps the takes of lines whose text did not change', () => {
    let draft = draftWith('Intro line\nMiddle line\nOutro line');
    const middle = draft.lines[1]!.id;
    draft = addTake(draft, middle, take('t1'));
    draft = resplit(draft, 'Intro line, edited\nMiddle line\nOutro line');
    expect(draft.lines[1]!.id).toBe(middle);
    expect(draft.lines[1]!.takes).toHaveLength(1);
    expect(draft.lines[0]!.takes).toHaveLength(0);
  });

  it('keeps repeated identical lines apart', () => {
    let draft = draftWith('Same\nSame');
    draft = addTake(draft, draft.lines[0]!.id, take('t1'));
    draft = resplit(draft, 'Same\nSame');
    expect(draft.lines.map((line) => line.takes.length)).toEqual([1, 0]);
  });
});

describe('takes', () => {
  it('picks, removes and clears takes for one line only', () => {
    let draft = draftWith('A\nB');
    const [a, b] = draft.lines.map((line) => line.id) as [string, string];
    draft = addTake(addTake(draft, a, take('a1')), a, take('a2'));
    draft = addTake(draft, b, take('b1'));
    expect(chosenTake(draft.lines[0]!)?.id).toBe('a1');
    draft = chooseTake(draft, a, 'a2');
    expect(chosenTake(draft.lines[0]!)?.id).toBe('a2');
    draft = removeTake(draft, a, 'a2');
    expect(draft.lines[0]!.chosen).toBeNull();
    draft = clearTakes(draft, a);
    expect(draft.lines[0]!.takes).toEqual([]);
    expect(draft.lines[1]!.takes).toHaveLength(1);
  });

  it('ignores a choice of a take the line does not have', () => {
    const draft = draftWith('A');
    expect(chooseTake(draft, draft.lines[0]!.id, 'missing').lines[0]!.chosen).toBeNull();
  });

  it('draws different seeds within the engine range', () => {
    const seeds = new Set(Array.from({ length: 20 }, randomSeed));
    expect(seeds.size).toBeGreaterThan(15);
    for (const seed of seeds) expect(seed).toBeGreaterThanOrEqual(0);
  });
});

describe('export names', () => {
  it('names files line-03_take-02.wav in script order', () => {
    let draft = draftWith('one\ntwo\nthree');
    const third = draft.lines[2]!.id;
    draft = addTake(addTake(draft, third, take('x')), third, take('y'));
    expect(takeFileName(draft, third, 'y')).toBe('line-03_take-02.wav');
  });

  it('pads to the number of lines so files sort correctly past 99', () => {
    let draft = draftWith(Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n'));
    const last = draft.lines[119]!.id;
    draft = addTake(draft, last, take('z'));
    expect(takeFileName(draft, last, 'z')).toBe('line-120_take-01.wav');
  });

  it('exports the chosen take per line, or every take', () => {
    let draft = draftWith('A\nB\nC');
    const [a, b] = draft.lines.map((line) => line.id) as [string, string];
    draft = addTake(addTake(draft, a, take('a1')), a, take('a2'));
    draft = chooseTake(draft, a, 'a2');
    draft = addTake(draft, b, take('b1'));
    expect(exportPlan(draft, 'chosen').map((item) => item.name)).toEqual([
      'line-01_take-02.wav',
      'line-02_take-01.wav',
    ]);
    expect(exportPlan(draft, 'all')).toHaveLength(3);
  });
});

describe('saved drafts', () => {
  it('round-trips through storage', () => {
    let draft = draftWith('A');
    draft = addTake(draft, draft.lines[0]!.id, take('a1'));
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it('falls back safely on missing or damaged data', () => {
    expect(parseDraft(null)).toEqual(emptyDraft());
    expect(parseDraft('{broken')).toEqual(emptyDraft());
    const damaged = parseDraft(
      JSON.stringify({
        version: 1,
        takesPerLine: 99,
        lines: [{ id: 'l', text: 'Hi', takes: [{ id: 1 }], chosen: 'gone' }, null],
      }),
    );
    expect(damaged.takesPerLine).toBe(DEFAULT_TAKES);
    expect(damaged.lines).toEqual([{ id: 'l', text: 'Hi', takes: [], chosen: null }]);
  });
});

describe('subtitle timing', () => {
  const cues = [
    { start: 1, end: 3.5, text: 'First cue.' },
    { start: 4, end: 6, text: 'Second cue.' },
  ];

  it('turns each cue into a timed line and remembers the file', () => {
    const draft = linesFromCues(emptyDraft(), cues, 'episode.srt');
    expect(draft.subtitles).toBe('episode.srt');
    expect(draft.source).toBe('First cue.\nSecond cue.');
    expect(draft.lines.map((line) => [line.text, line.slot])).toEqual([
      ['First cue.', { start: 1, end: 3.5 }],
      ['Second cue.', { start: 4, end: 6 }],
    ]);
    expect(slotSeconds(draft.lines[0]!)).toBe(2.5);
  });

  it('flags takes longer than their slot, with a frame of tolerance', () => {
    const draft = linesFromCues(emptyDraft(), cues, 'episode.srt');
    const line = draft.lines[0]!;
    expect(overrun(line, { ...take('a'), durationSeconds: 2.53 })).toBe(0);
    expect(overrun(line, { ...take('a'), durationSeconds: 3 })).toBeCloseTo(0.5);
    expect(overrun(line, { ...take('a'), durationSeconds: null })).toBeNull();
    expect(overrun({ ...line, slot: undefined }, take('a'))).toBeNull();
  });

  it('writes a matching SRT: cue N for clip line-N, as long as the chosen take', () => {
    let draft = linesFromCues(emptyDraft(), cues, 'episode.srt');
    draft = addTake(draft, draft.lines[0]!.id, { ...take('a'), durationSeconds: 2.25 });
    expect(exportSubtitles(draft)).toBe(
      '1\n00:00:01,000 --> 00:00:03,250\nFirst cue.\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond cue.\n',
    );
    expect(exportSubtitles(draftWith('typed script'))).toBeNull();
  });

  it('can drop the timing and keep the lines and takes', () => {
    let draft = linesFromCues(emptyDraft(), cues, 'episode.srt');
    draft = addTake(draft, draft.lines[0]!.id, take('a'));
    const untimed = removeTiming(draft);
    expect(untimed.subtitles).toBeNull();
    expect(untimed.lines.every((line) => line.slot === undefined)).toBe(true);
    expect(untimed.lines[0]!.takes).toHaveLength(1);
  });

  it('saves and restores timed lines, dropping broken slots', () => {
    const draft = linesFromCues(emptyDraft(), cues, 'episode.srt');
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
    const broken = JSON.parse(JSON.stringify(draft));
    broken.lines[0].slot = { start: 5, end: 2 };
    expect(parseDraft(JSON.stringify(broken)).lines[0]!.slot).toBeUndefined();
  });
});
