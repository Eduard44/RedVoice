import { describe, expect, it, vi } from 'vitest';

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiJson: fetchJson }));

import { addTake, emptyDraft, exportPlan, linesFromCues, resplit } from './script-model';
import { RESOLVE_ERROR_CODES, resolveClips, resolveErrorKey, sendToResolve } from './resolve';
import en from '@/i18n/locales/en.json';

const take = (id: string, durationSeconds = 1.5) => ({
  id,
  audioPath: `${id}.wav`,
  seed: 1,
  durationSeconds,
});

describe('resolveClips', () => {
  it('sends timed lines at their subtitle start, under the written file names', () => {
    let draft = linesFromCues(
      emptyDraft(),
      [
        { start: 1, end: 3, text: 'One' },
        { start: 5.5, end: 7, text: 'Two' },
      ],
      'cues.srt',
    );
    draft = addTake(draft, draft.lines[0]!.id, take('a', 1.8));
    draft = addTake(draft, draft.lines[1]!.id, take('b', 1.2));
    const plan = exportPlan(draft, 'chosen');
    expect(resolveClips(draft, plan, ['line-1.wav', 'line-2.wav'])).toEqual([
      { file: 'line-1.wav', start_seconds: 1, duration_seconds: 1.8 },
      { file: 'line-2.wav', start_seconds: 5.5, duration_seconds: 1.2 },
    ]);
  });

  it('leaves untimed lines without a start so Resolve lines them up from the playhead', () => {
    let draft = resplit(emptyDraft(), 'A\nB');
    draft = addTake(draft, draft.lines[1]!.id, take('b'));
    const plan = exportPlan(draft, 'chosen');
    expect(resolveClips(draft, plan, [])).toEqual([
      { file: 'line-02_take-01.wav', start_seconds: null, duration_seconds: 1.5 },
    ]);
  });
});

describe('sendToResolve', () => {
  it('posts the folder and clips', async () => {
    fetchJson.mockResolvedValue({ ok: true });
    await sendToResolve('C:\\VO', [{ file: 'a.wav', start_seconds: null, duration_seconds: 1 }]);
    expect(fetchJson).toHaveBeenCalledWith('/resolve/send', {
      method: 'POST',
      body: JSON.stringify({
        folder: 'C:\\VO',
        clips: [{ file: 'a.wav', start_seconds: null, duration_seconds: 1 }],
      }),
    });
  });
});

describe('resolveErrorKey', () => {
  it('has an English text for every code the backend reports', () => {
    const script = en.script as Record<string, string>;
    for (const code of [...RESOLVE_ERROR_CODES, 'unknown', null]) {
      const key = resolveErrorKey(code).replace('script.', '');
      expect(script[key], key).toBeTruthy();
    }
    expect(resolveErrorKey('resolve_not_running')).toBe('script.resolve_not_running');
    expect(resolveErrorKey('no_timeline')).toBe('script.resolve_no_timeline');
    expect(resolveErrorKey('weird')).toBe('script.resolve_failed');
  });
});
