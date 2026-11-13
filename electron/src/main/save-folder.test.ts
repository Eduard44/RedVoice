// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertSaveFolderRequest,
  MAX_FOLDER_FILES,
  saveFilesToFolder,
  type SaveFolderDialogs,
} from './save-folder';

const bytes = (text: string) => new TextEncoder().encode(text);
const labels = { title: 'Pick', replaceMessage: 'Replace?', replace: 'Replace', cancel: 'Cancel' };

describe('assertSaveFolderRequest', () => {
  it('accepts named byte arrays and makes names safe for every file system', () => {
    const req = assertSaveFolderRequest({
      files: [{ name: 'line-01:take-01?.wav', data: bytes('a') }],
      labels,
    });
    expect(req.files[0]!.name).toBe('line-01_take-01_.wav');
    expect(req.labels).toEqual(labels);
  });

  it('rejects missing data, empty lists, duplicates and oversize batches', () => {
    expect(() => assertSaveFolderRequest(null)).toThrow();
    expect(() => assertSaveFolderRequest({ files: [] })).toThrow('No files');
    expect(() => assertSaveFolderRequest({ files: [{ name: 'a.wav', data: 'x' }] })).toThrow(
      'Invalid file data',
    );
    expect(() =>
      assertSaveFolderRequest({
        files: [
          { name: 'A.wav', data: bytes('a') },
          { name: 'a.wav', data: bytes('b') },
        ],
      }),
    ).toThrow('Duplicate');
    const many = Array.from({ length: MAX_FOLDER_FILES + 1 }, (_, i) => ({
      name: `${i}.wav`,
      data: bytes('x'),
    }));
    expect(() => assertSaveFolderRequest({ files: many })).toThrow('Too many');
  });

  it('falls back to English dialog texts when labels are missing', () => {
    const req = assertSaveFolderRequest({ files: [{ name: 'a.wav', data: bytes('a') }] });
    expect(req.labels.replace).toBe('Replace');
  });
});

describe('saveFilesToFolder', () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'redvoice-folder-'));
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });
  const dialogs = (over: Partial<SaveFolderDialogs> = {}): SaveFolderDialogs => ({
    pickFolder: vi.fn(async () => folder),
    confirmReplace: vi.fn(async () => true),
    ...over,
  });
  const request = () =>
    assertSaveFolderRequest({
      files: [
        { name: 'line-01_take-01.wav', data: bytes('one') },
        { name: 'line-02_take-01.wav', data: bytes('two') },
      ],
      labels,
    });

  it('writes every file into the chosen folder', async () => {
    const result = await saveFilesToFolder(request(), dialogs());
    expect(result).toEqual({
      canceled: false,
      path: folder,
      written: ['line-01_take-01.wav', 'line-02_take-01.wav'],
    });
    expect((await readdir(folder)).sort()).toEqual(['line-01_take-01.wav', 'line-02_take-01.wav']);
    expect(await readFile(join(folder, 'line-02_take-01.wav'), 'utf8')).toBe('two');
  });

  it('writes nothing when the folder picker is cancelled', async () => {
    const write = vi.fn();
    const result = await saveFilesToFolder(
      request(),
      dialogs({ pickFolder: async () => null }),
      write,
    );
    expect(result).toEqual({ canceled: true });
    expect(write).not.toHaveBeenCalled();
  });

  it('asks before replacing and keeps existing files when the user says no', async () => {
    await writeFile(join(folder, 'line-01_take-01.wav'), 'keep me');
    const confirmReplace = vi.fn(async () => false);
    const result = await saveFilesToFolder(request(), dialogs({ confirmReplace }));
    expect(confirmReplace).toHaveBeenCalledWith(labels, ['line-01_take-01.wav']);
    expect(result).toEqual({ canceled: true });
    expect(await readFile(join(folder, 'line-01_take-01.wav'), 'utf8')).toBe('keep me');
    expect(await readdir(folder)).toEqual(['line-01_take-01.wav']);
  });

  it('replaces existing files once the user confirms', async () => {
    await writeFile(join(folder, 'line-01_take-01.wav'), 'old');
    await saveFilesToFolder(request(), dialogs());
    expect(await readFile(join(folder, 'line-01_take-01.wav'), 'utf8')).toBe('one');
  });

  it('refuses to write over a folder with the same name', async () => {
    await mkdir(join(folder, 'line-01_take-01.wav'));
    await expect(saveFilesToFolder(request(), dialogs())).rejects.toThrow('in the way');
  });
});
