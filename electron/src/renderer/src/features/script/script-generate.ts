import type { CloneSettings } from '@/lib/store/clone-settings';
import type { CloneGenerateInput, GenerateResult } from '@/lib/api/types';
import { randomSeed, type ScriptDraft, type ScriptTake } from './script-model';

/** One line that needs `count` more takes. */
export interface TakeJob {
  lineId: string;
  text: string;
  count: number;
}

/** Lines with fewer takes than the draft asks for, each topped up to that number. */
export function missingTakes(draft: ScriptDraft): TakeJob[] {
  return draft.lines
    .filter((line) => line.takes.length < draft.takesPerLine)
    .map((line) => ({
      lineId: line.id,
      text: line.text,
      count: draft.takesPerLine - line.takes.length,
    }));
}

/**
 * The same request the Clone page sends, with the line's text, the script's
 * voice and language, a 24-bit file and a fresh seed so each take differs.
 */
export function takeInput(
  settings: CloneSettings,
  draft: ScriptDraft,
  text: string,
  seed: number,
): CloneGenerateInput {
  return {
    text,
    language: draft.language,
    profileId: draft.profileId,
    seed,
    wavBits: 24,
    effectPreset: settings.effectPreset,
    steps: settings.steps,
    cfg: settings.cfg,
    speed: settings.speed,
    tShift: settings.tShift,
    posTemp: settings.posTemp,
    classTemp: settings.classTemp,
    layerPenalty: settings.layerPenalty,
    denoise: settings.denoise,
    postprocess: settings.postprocess,
    duration: '',
  };
}

export interface TakeProgress {
  /** 1-based position among the jobs and among one job's takes. */
  line: number;
  lines: number;
  take: number;
  takes: number;
}

/**
 * Generates the takes one after another, handing each finished take over at
 * once so the page shows it while the rest render. Stops between takes when
 * the signal aborts; a failed take stops the run and reports which line.
 */
export async function runTakes(
  jobs: TakeJob[],
  makeInput: (text: string, seed: number) => CloneGenerateInput,
  generate: (input: CloneGenerateInput, signal: AbortSignal) => Promise<GenerateResult>,
  callbacks: {
    onProgress: (progress: TakeProgress) => void;
    onTake: (lineId: string, take: ScriptTake) => void;
  },
  signal: AbortSignal,
): Promise<void> {
  for (const [index, job] of jobs.entries()) {
    for (let take = 0; take < job.count; take++) {
      signal.throwIfAborted();
      callbacks.onProgress({
        line: index + 1,
        lines: jobs.length,
        take: take + 1,
        takes: job.count,
      });
      const seed = randomSeed();
      const result = await generate(makeInput(job.text, seed), signal);
      if (!result.audioPath) throw new Error('The engine returned no audio file');
      callbacks.onTake(job.lineId, {
        id: result.id ?? `${job.lineId}-${seed}`,
        audioPath: result.audioPath,
        seed: result.seed ?? seed,
        durationSeconds: result.durationSeconds,
      });
    }
  }
}
