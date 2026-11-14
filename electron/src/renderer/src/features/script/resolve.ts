import { apiJson } from '@/lib/api/client';
import type { ExportItem, ScriptDraft } from './script-model';

/** One exported clip as the backend's `/resolve/send` route expects it. */
export interface ResolveClip {
  file: string;
  start_seconds: number | null;
  duration_seconds: number | null;
}

export interface ResolveResult {
  ok: boolean;
  code: string | null;
  timeline: string | null;
  tracks: string[];
  placed: number;
  files: string[];
  warnings: string[];
}

/** Error codes the backend reports, each with its own message. */
export const RESOLVE_ERROR_CODES = [
  'resolve_not_installed',
  'resolve_not_running',
  'no_project',
  'no_timeline',
  'import_failed',
  'track_failed',
  'place_failed',
  'timeout',
] as const;

/**
 * The clips of an export, by the names they were written under. Timed lines
 * start at their subtitle; untimed lines are placed one after another.
 */
export function resolveClips(
  draft: ScriptDraft,
  plan: ExportItem[],
  written: readonly string[],
): ResolveClip[] {
  return plan.map((item, index) => {
    const line = draft.lines.find((entry) => entry.id === item.lineId);
    return {
      file: written[index] ?? item.name,
      start_seconds: draft.subtitles && line?.slot ? line.slot.start : null,
      duration_seconds: item.take.durationSeconds,
    };
  });
}

export function sendToResolve(folder: string, clips: ResolveClip[]): Promise<ResolveResult> {
  return apiJson<ResolveResult>('/resolve/send', {
    method: 'POST',
    body: JSON.stringify({ folder, clips }),
  });
}

/** Translation key for a failed send. */
export function resolveErrorKey(code: string | null): string {
  return (RESOLVE_ERROR_CODES as readonly string[]).includes(code ?? '')
    ? `script.resolve_${(code ?? '').replace(/^resolve_/, '')}`
    : 'script.resolve_failed';
}
