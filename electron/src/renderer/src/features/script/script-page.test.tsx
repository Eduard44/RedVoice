import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CloneGenerateInput } from '@/lib/api/types';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  save: vi.fn(),
  fetch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'number' in options ? `${key}:${String(options.number)}` : key,
  }),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/hooks/use-profiles', () => ({
  useProfiles: () => ({ data: [{ id: 'voice-1', name: 'Narrator' }] }),
}));
vi.mock('@shared/components/VoiceSelector', () => ({
  default: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange('voice-1')}>
      pick voice
    </button>
  ),
}));
vi.mock('@shared/components/SearchableSelect', () => ({ default: () => null }));
vi.mock('@/components/app-shell/workspace-header', () => ({
  WorkspaceHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
vi.mock('@/lib/api/generate', () => ({ generateClone: mocks.generate }));
vi.mock('@/lib/native-save', () => ({ saveNativeFolder: mocks.save }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiFetch: mocks.fetch,
}));
vi.mock('./wav-export', () => ({ toTimelineWav: () => new Uint8Array([1, 2, 3]) }));

import { ScriptPage } from './script-page';

beforeEach(() => {
  localStorage.clear();
  let n = 0;
  mocks.generate.mockImplementation(async (input: CloneGenerateInput) => ({
    blob: new Blob(),
    id: `take-${++n}`,
    audioPath: `take-${n}.wav`,
    durationSeconds: 1.2,
    genTimeSeconds: 1,
    seed: input.seed ?? null,
    routing: null,
    dropped: null,
  }));
  mocks.fetch.mockImplementation(async () => new Response(new Uint8Array([0])));
  mocks.save.mockResolvedValue({ canceled: false, path: '/clips', written: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function scriptWithTakes() {
  render(<ScriptPage />);
  fireEvent.click(screen.getByText('pick voice'));
  fireEvent.change(screen.getByLabelText('script.script_text'), {
    target: { value: 'First line.\nSecond line.' },
  });
  fireEvent.click(screen.getByText('script.apply'));
  expect(screen.getAllByTestId('script-line')).toHaveLength(2);
  fireEvent.click(screen.getByText('script.generate'));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(6));
  await waitFor(() => expect(screen.getAllByLabelText(/script.play_take/)).toHaveLength(6));
}

it('splits the script and generates three takes per line with the chosen voice', async () => {
  await scriptWithTakes();
  const inputs = mocks.generate.mock.calls.map(([input]) => input as CloneGenerateInput);
  expect(inputs.map((input) => input.text)).toEqual([
    'First line.',
    'First line.',
    'First line.',
    'Second line.',
    'Second line.',
    'Second line.',
  ]);
  expect(new Set(inputs.map((input) => input.seed)).size).toBe(6);
  expect(inputs.every((input) => input.profileId === 'voice-1' && input.wavBits === 24)).toBe(true);
});

it('asks for a voice before generating', () => {
  render(<ScriptPage />);
  fireEvent.change(screen.getByLabelText('script.script_text'), { target: { value: 'Line' } });
  fireEvent.click(screen.getByText('script.apply'));
  fireEvent.click(screen.getByText('script.generate'));
  expect(mocks.toastError).toHaveBeenCalledWith('script.no_voice');
  expect(mocks.generate).not.toHaveBeenCalled();
});

it('exports the chosen take of each line as line-NN_take-NN.wav', async () => {
  await scriptWithTakes();
  // Pick the second take of the first line.
  fireEvent.click(screen.getAllByLabelText('script.use_take:2')[0]!);
  fireEvent.click(screen.getByText('script.export_chosen'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  const request = mocks.save.mock.calls[0]![0] as { files: { name: string }[] };
  expect(request.files.map((file) => file.name)).toEqual([
    'line-01_take-02.wav',
    'line-02_take-01.wav',
  ]);
  expect(mocks.fetch).toHaveBeenCalledWith('/audio/take-2.wav');
  expect(mocks.toastSuccess).toHaveBeenCalled();
});

it('regenerates only the line asked for', async () => {
  await scriptWithTakes();
  mocks.generate.mockClear();
  fireEvent.click(screen.getAllByLabelText('script.regenerate')[1]!);
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(3));
  const texts = mocks.generate.mock.calls.map(([input]) => (input as CloneGenerateInput).text);
  expect(new Set(texts)).toEqual(new Set(['Second line.']));
  await waitFor(() => expect(screen.getAllByLabelText(/script.play_take/)).toHaveLength(6));
});

it('names the line when a take no longer exists on the backend', async () => {
  await scriptWithTakes();
  mocks.fetch.mockResolvedValue(new Response('', { status: 404 }));
  fireEvent.click(screen.getByText('script.export_all'));
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('script.take_missing:1'));
  expect(mocks.save).not.toHaveBeenCalled();
});

it('keeps the script and takes after reopening the page', async () => {
  await scriptWithTakes();
  cleanup();
  render(<ScriptPage />);
  expect(screen.getAllByTestId('script-line')).toHaveLength(2);
  expect(screen.getAllByLabelText(/script.play_take/)).toHaveLength(6);
});

const SRT = `1
00:00:01,000 --> 00:00:03,500
Every great edit starts with a single frame.

2
00:00:04,000 --> 00:00:05,000
Cut on the beat.
`;

async function importSubtitles() {
  render(<ScriptPage />);
  fireEvent.click(screen.getByText('pick voice'));
  const file = new File([SRT], 'episode.srt', { type: 'application/x-subrip' });
  fireEvent.change(screen.getByTestId('subtitle-file'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getAllByTestId('script-line')).toHaveLength(2));
}

it('imports subtitles as timed lines and asks each take for its slot length', async () => {
  await importSubtitles();
  expect(screen.getByTestId('subtitle-timing')).toBeInTheDocument();
  expect(screen.getAllByTestId('line-slot')).toHaveLength(2);
  expect(screen.getByLabelText('script.script_text')).toHaveAttribute('readonly');
  fireEvent.click(screen.getByText('script.generate'));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(6));
  const durations = mocks.generate.mock.calls.map(
    ([input]) => (input as CloneGenerateInput).duration,
  );
  expect(durations).toEqual(['2.500', '2.500', '2.500', '1.000', '1.000', '1.000']);
});

it('marks a take that runs past its subtitle', async () => {
  mocks.generate.mockImplementation(async (input: CloneGenerateInput) => ({
    blob: new Blob(),
    id: `take-${input.seed}`,
    audioPath: `take-${input.seed}.wav`,
    durationSeconds: Number(input.duration) + 0.4,
    genTimeSeconds: 1,
    seed: input.seed ?? null,
    routing: null,
    dropped: null,
  }));
  await importSubtitles();
  fireEvent.click(screen.getByText('script.generate'));
  await waitFor(() => expect(screen.getAllByTestId('take-over')).toHaveLength(6));
});

it('exports the clips with a matching voice-over.srt', async () => {
  await importSubtitles();
  fireEvent.click(screen.getByText('script.generate'));
  await waitFor(() => expect(screen.getAllByLabelText(/script.play_take/)).toHaveLength(6));
  fireEvent.click(screen.getByText('script.export_chosen'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  const request = mocks.save.mock.calls[0]![0] as { files: { name: string; data: Uint8Array }[] };
  expect(request.files.map((file) => file.name)).toEqual([
    'line-01_take-01.wav',
    'line-02_take-01.wav',
    'voice-over.srt',
  ]);
  const srt = new TextDecoder().decode(request.files[2]!.data);
  expect(srt).toContain('1\n00:00:01,000 --> 00:00:02,200\nEvery great edit starts');
  expect(mocks.toastSuccess).toHaveBeenCalled();
});

it('rejects a file without timed subtitles', async () => {
  render(<ScriptPage />);
  const file = new File(['no timings here'], 'notes.srt');
  fireEvent.change(screen.getByTestId('subtitle-file'), { target: { files: [file] } });
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('script.import_failed'));
  expect(screen.queryAllByTestId('script-line')).toHaveLength(0);
});

it('can remove the timing and edit the script as text again', async () => {
  await importSubtitles();
  fireEvent.click(screen.getByText('script.remove_timing'));
  expect(screen.queryByTestId('subtitle-timing')).toBeNull();
  expect(screen.queryAllByTestId('line-slot')).toHaveLength(0);
  expect(screen.getByLabelText('script.script_text')).not.toHaveAttribute('readonly');
});
