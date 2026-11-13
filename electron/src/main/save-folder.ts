import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { portableFilename } from './portable-filename';
import { replaceFile } from './replace-file';

/** One file to write into the folder the user picks. */
export interface FolderFile {
  name: string;
  data: Uint8Array;
}

/** Translated texts for the native dialogs; main never ships its own copy. */
export interface SaveFolderLabels {
  title: string;
  replaceMessage: string;
  replace: string;
  cancel: string;
}

export interface SaveFolderRequest {
  files: FolderFile[];
  labels: SaveFolderLabels;
}

export interface SaveFolderResult {
  canceled: boolean;
  /** The folder the files were written to. */
  path?: string;
  /** File names as written (after making them safe for every file system). */
  written?: string[];
}

/** A script with every line and take still fits: 500 files, 4 GiB in total. */
export const MAX_FOLDER_FILES = 500;
export const MAX_FOLDER_BYTES = 4 * 1024 ** 3;

const LABEL_FALLBACK: SaveFolderLabels = {
  title: 'Choose a folder',
  replaceMessage: 'Some files already exist in this folder. Replace them?',
  replace: 'Replace',
  cancel: 'Cancel',
};

function labels(raw: unknown): SaveFolderLabels {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof SaveFolderLabels) => {
    const value = input[key];
    return typeof value === 'string' && value.trim() && value.length <= 300
      ? value
      : LABEL_FALLBACK[key];
  };
  return {
    title: pick('title'),
    replaceMessage: pick('replaceMessage'),
    replace: pick('replace'),
    cancel: pick('cancel'),
  };
}

/** Validates the renderer's request: real bytes, safe unique names, bounded size. */
export function assertSaveFolderRequest(value: unknown): SaveFolderRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid save request');
  const req = value as { files?: unknown; labels?: unknown };
  if (!Array.isArray(req.files) || req.files.length === 0) throw new Error('No files to save');
  if (req.files.length > MAX_FOLDER_FILES) throw new Error('Too many files to save at once');
  const seen = new Set<string>();
  let total = 0;
  const files = req.files.map((entry: unknown) => {
    const file = entry as { name?: unknown; data?: unknown } | null;
    if (!file || !(file.data instanceof Uint8Array)) throw new Error('Invalid file data');
    if (typeof file.name !== 'string' || !file.name) throw new Error('Invalid file name');
    const name = portableFilename(file.name);
    // Case-insensitive file systems (Windows, macOS) would merge these.
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate file name');
    seen.add(key);
    total += file.data.byteLength;
    if (total > MAX_FOLDER_BYTES) throw new Error('Files are too large to save at once');
    return { name, data: file.data };
  });
  return { files, labels: labels(req.labels) };
}

export interface SaveFolderDialogs {
  pickFolder(title: string): Promise<string | null>;
  confirmReplace(labels: SaveFolderLabels, names: string[]): Promise<boolean>;
}

/**
 * Asks for a folder, then writes every file into it. Existing files are only
 * replaced after the user confirms; each write is atomic, so a failure leaves
 * an existing file as it was.
 */
export async function saveFilesToFolder(
  req: SaveFolderRequest,
  dialogs: SaveFolderDialogs,
  write: (path: string, data: Uint8Array) => Promise<void> = replaceFile,
): Promise<SaveFolderResult> {
  const folder = await dialogs.pickFolder(req.labels.title);
  if (!folder) return { canceled: true };
  const existing: string[] = [];
  for (const file of req.files) {
    const found = await stat(join(folder, file.name)).catch(() => null);
    if (found?.isDirectory()) throw new Error(`A folder named ${file.name} is in the way`);
    if (found) existing.push(file.name);
  }
  if (existing.length && !(await dialogs.confirmReplace(req.labels, existing)))
    return { canceled: true };
  for (const file of req.files) await write(join(folder, file.name), file.data);
  return { canceled: false, path: folder, written: req.files.map((file) => file.name) };
}
