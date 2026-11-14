import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLONE_SETTINGS } from '@/lib/store/clone-settings';
import type { CloneGenerateInput, GenerateResult } from '@/lib/api/types';
import { addTake, emptyDraft, resplit } from './script-model';
import { missingTakes, runTakes, takeInput } from './script-generate';
import { linesFromCues } from './script-model';

const result = (n: number): GenerateResult => ({
  blob: new Blob(),
  id: `id-${n}`,
  audioPath: `take-${n}.wav`,
  durationSeconds: 1.5,
  genTimeSeconds: 1,
  seed: 1000 + n,
  routing: null,
  dropped: null,
});

describe('missingTakes', () => {
  it('tops every line up to the takes per line', () => {
    let draft = { ...resplit(emptyDraft(), 'A\nB'), takesPerLine: 3 };
    draft = addTake(draft, draft.lines[0]!.id, {
      id: 'x',
      audioPath: 'x.wav',
      seed: 1,
      durationSeconds: 1,
    });
    expect(missingTakes(draft).map((job) => [job.text, job.count])).toEqual([
      ['A', 2],
      ['B', 3],
    ]);
  });
});

describe('takeInput', () => {
  it('sends the line with the script voice, a 24-bit file and the given seed', () => {
    const draft = { ...emptyDraft(), profileId: 'voice-1', language: 'English' };
    const input = takeInput(DEFAULT_CLONE_SETTINGS, draft, 'Hello', 42);
    expect(input).toMatchObject({
      text: 'Hello',
      profileId: 'voice-1',
      language: 'English',
      seed: 42,
      wavBits: 24,
    });
  });
});

describe('runTakes', () => {
  it('generates each take in order and hands it over as soon as it is ready', async () => {
    let n = 0;
    const generate = vi.fn(async (_input: CloneGenerateInput, _signal: AbortSignal) => result(++n));
    const onTake = vi.fn();
    const onProgress = vi.fn();
    await runTakes(
      [
        { lineId: 'a', text: 'A', count: 2 },
        { lineId: 'b', text: 'B', count: 1 },
      ],
      (text, seed) => ({ text, seed }) as never,
      generate,
      { onTake, onProgress },
      new AbortController().signal,
    );
    expect(generate).toHaveBeenCalledTimes(3);
    expect(onTake.mock.calls.map(([line, take]) => [line, take.audioPath, take.seed])).toEqual([
      ['a', 'take-1.wav', 1001],
      ['a', 'take-2.wav', 1002],
      ['b', 'take-3.wav', 1003],
    ]);
    expect(onProgress).toHaveBeenLastCalledWith({ line: 2, lines: 2, take: 1, takes: 1 });
    // Each take asks for its own seed, so takes of one line differ.
    const seeds = generate.mock.calls.map(([input]) => input.seed);
    expect(new Set(seeds).size).toBe(3);
  });

  it('stops before the next take once stopped', async () => {
    const controller = new AbortController();
    const generate = vi.fn(async () => {
      controller.abort();
      return result(1);
    });
    await expect(
      runTakes(
        [{ lineId: 'a', text: 'A', count: 3 }],
        (text, seed) => ({ text, seed }) as never,
        generate,
        { onTake: vi.fn(), onProgress: vi.fn() },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when the engine returns no file', async () => {
    await expect(
      runTakes(
        [{ lineId: 'a', text: 'A', count: 1 }],
        (text, seed) => ({ text, seed }) as never,
        async () => ({ ...result(1), audioPath: null }),
        { onTake: vi.fn(), onProgress: vi.fn() },
        new AbortController().signal,
      ),
    ).rejects.toThrow('no audio');
  });
});

describe('takes timed to subtitles', () => {
  it('asks each take of a timed line for its slot length, unless fitting is off', () => {
    const draft = linesFromCues(emptyDraft(), [{ start: 2, end: 4.75, text: 'Hi' }], 'a.srt');
    expect(missingTakes(draft)[0]!.duration).toBeCloseTo(2.75);
    expect(missingTakes({ ...draft, fitToTiming: false })[0]!.duration).toBeUndefined();
    expect(takeInput(DEFAULT_CLONE_SETTINGS, draft, 'Hi', 1, 2.75).duration).toBe('2.750');
    expect(takeInput(DEFAULT_CLONE_SETTINGS, draft, 'Hi', 1).duration).toBe('');
  });

  it('passes the target length to every take of the job', async () => {
    const makeInput = vi.fn(
      (text: string, seed: number, duration?: number) => ({ text, seed, duration }) as never,
    );
    await runTakes(
      [{ lineId: 'a', text: 'A', count: 2, duration: 1.5 }],
      makeInput,
      async () => result(1),
      { onTake: vi.fn(), onProgress: vi.fn() },
      new AbortController().signal,
    );
    expect(makeInput.mock.calls.map((call) => call[2])).toEqual([1.5, 1.5]);
  });
});
