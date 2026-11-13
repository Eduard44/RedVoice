import { splitStoryText } from '@shared/utils/splitStoryText';

/** One generated take of a line; the audio lives in the backend's history. */
export interface ScriptTake {
  id: string;
  /** Bare filename under `/audio/` (X-Audio-Path). */
  audioPath: string;
  seed: number | null;
  durationSeconds: number | null;
}

export interface ScriptLine {
  id: string;
  text: string;
  takes: ScriptTake[];
  /** The take picked for export, or null to use the first take. */
  chosen: string | null;
}

/** How a pasted script becomes lines. */
export type ScriptSplit = 'lines' | 'sentences';

export interface ScriptDraft {
  version: 1;
  /** The script as pasted, kept so it can be split again. */
  source: string;
  split: ScriptSplit;
  lines: ScriptLine[];
  profileId: string | null;
  /** Display-name language ("English"), as the Clone page sends it. */
  language: string;
  takesPerLine: number;
}

export const MIN_TAKES = 1;
export const MAX_TAKES = 10;
export const DEFAULT_TAKES = 3;
export const SCRIPT_STORAGE_KEY = 'redvoice.script.v1';

export function emptyDraft(): ScriptDraft {
  return {
    version: 1,
    source: '',
    split: 'lines',
    lines: [],
    profileId: null,
    language: 'English',
    takesPerLine: DEFAULT_TAKES,
  };
}

function newId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/** Each non-empty line, or each sentence, becomes its own clip. */
export function splitScript(source: string, split: ScriptSplit): string[] {
  if (split === 'sentences') return splitStoryText(source, 'sentences');
  return source
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Splits the script again. A line whose text did not change keeps its takes,
 * so editing one line never throws away the others.
 */
export function resplit(
  draft: ScriptDraft,
  source = draft.source,
  split = draft.split,
): ScriptDraft {
  const unused = new Map<string, ScriptLine[]>();
  for (const line of draft.lines) unused.set(line.text, [...(unused.get(line.text) ?? []), line]);
  const lines = splitScript(source, split).map((text) => {
    const reused = unused.get(text)?.shift();
    return reused ?? { id: newId(), text, takes: [], chosen: null };
  });
  return { ...draft, source, split, lines };
}

export function updateLine(
  draft: ScriptDraft,
  lineId: string,
  change: (line: ScriptLine) => ScriptLine,
): ScriptDraft {
  return {
    ...draft,
    lines: draft.lines.map((line) => (line.id === lineId ? change(line) : line)),
  };
}

export function addTake(draft: ScriptDraft, lineId: string, take: ScriptTake): ScriptDraft {
  return updateLine(draft, lineId, (line) => ({ ...line, takes: [...line.takes, take] }));
}

export function chooseTake(draft: ScriptDraft, lineId: string, takeId: string): ScriptDraft {
  return updateLine(draft, lineId, (line) =>
    line.takes.some((take) => take.id === takeId) ? { ...line, chosen: takeId } : line,
  );
}

export function removeTake(draft: ScriptDraft, lineId: string, takeId: string): ScriptDraft {
  return updateLine(draft, lineId, (line) => ({
    ...line,
    takes: line.takes.filter((take) => take.id !== takeId),
    chosen: line.chosen === takeId ? null : line.chosen,
  }));
}

/** Drops a line's takes so it can be generated again from scratch. */
export function clearTakes(draft: ScriptDraft, lineId: string): ScriptDraft {
  return updateLine(draft, lineId, (line) => ({ ...line, takes: [], chosen: null }));
}

/** The take a line exports: the picked one, else its first. */
export function chosenTake(line: ScriptLine): ScriptTake | null {
  return line.takes.find((take) => take.id === line.chosen) ?? line.takes[0] ?? null;
}

const pad = (value: number, total: number) =>
  String(value).padStart(Math.max(2, String(total).length), '0');

/** `line-03_take-02.wav`: numbered by position, padded so files sort in script order. */
export function takeFileName(draft: ScriptDraft, lineId: string, takeId: string): string {
  const lineIndex = draft.lines.findIndex((line) => line.id === lineId);
  const line = draft.lines[lineIndex];
  const takeIndex = line?.takes.findIndex((take) => take.id === takeId) ?? -1;
  if (!line || takeIndex < 0) throw new Error('Unknown take');
  const mostTakes = Math.max(...draft.lines.map((entry) => entry.takes.length), 1);
  return `line-${pad(lineIndex + 1, draft.lines.length)}_take-${pad(takeIndex + 1, mostTakes)}.wav`;
}

export interface ExportItem {
  name: string;
  take: ScriptTake;
}

/** What an export writes: one file per line (its chosen take), or every take. */
export function exportPlan(draft: ScriptDraft, which: 'chosen' | 'all'): ExportItem[] {
  return draft.lines.flatMap((line) => {
    const takes = which === 'all' ? line.takes : [chosenTake(line)].filter((take) => take !== null);
    return takes.map((take) => ({ name: takeFileName(draft, line.id, take.id), take }));
  });
}

function isTake(value: unknown): value is ScriptTake {
  const take = value as Partial<ScriptTake> | null;
  return (
    !!take &&
    typeof take.id === 'string' &&
    typeof take.audioPath === 'string' &&
    (take.seed === null || Number.isInteger(take.seed)) &&
    (take.durationSeconds === null || Number.isFinite(take.durationSeconds))
  );
}

/** Reads a saved draft; anything malformed falls back to an empty one. */
export function parseDraft(raw: string | null): ScriptDraft {
  const fallback = emptyDraft();
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<ScriptDraft> | null;
    if (!value || value.version !== 1) return fallback;
    const lines = Array.isArray(value.lines)
      ? value.lines.flatMap((entry) => {
          const line = entry as Partial<ScriptLine> | null;
          if (!line || typeof line.id !== 'string' || typeof line.text !== 'string') return [];
          const takes = Array.isArray(line.takes) ? line.takes.filter(isTake) : [];
          const chosen =
            typeof line.chosen === 'string' && takes.some((take) => take.id === line.chosen)
              ? line.chosen
              : null;
          return [{ id: line.id, text: line.text, takes, chosen }];
        })
      : [];
    const takes = Number(value.takesPerLine);
    return {
      version: 1,
      source: typeof value.source === 'string' ? value.source : '',
      split: value.split === 'sentences' ? 'sentences' : 'lines',
      lines,
      profileId: typeof value.profileId === 'string' ? value.profileId : null,
      language: typeof value.language === 'string' && value.language ? value.language : 'English',
      takesPerLine:
        Number.isInteger(takes) && takes >= MIN_TAKES && takes <= MAX_TAKES ? takes : DEFAULT_TAKES,
    };
  } catch {
    return fallback;
  }
}

/** A fresh random seed per take, so takes of the same line differ and can be reproduced. */
export function randomSeed(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0]! % 2_147_483_647;
}
