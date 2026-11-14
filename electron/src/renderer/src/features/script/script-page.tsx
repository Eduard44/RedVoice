import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CaptionsIcon,
  CheckIcon,
  ClapperboardIcon,
  FolderDownIcon,
  ListPlusIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
// @ts-expect-error shared JSX component has no declaration file
import VoiceSelector from '@shared/components/VoiceSelector';
// @ts-expect-error shared JSX component has no declaration file
import SearchableSelect from '@shared/components/SearchableSelect';
import { WorkspaceHeader } from '@/components/app-shell/workspace-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useProfiles } from '@/hooks/use-profiles';
import { apiFetch, audioUrl, describeError, isAbortError } from '@/lib/api/client';
import { generateClone } from '@/lib/api/generate';
import { LANGUAGES } from '@/lib/languages';
import { saveNativeFolder } from '@/lib/native-save';
import { cloneSettingsStore } from '@/lib/store/clone-settings';
import { cn } from '@/lib/utils';
import {
  addTake,
  chooseTake,
  chosenTake,
  clearTakes,
  exportPlan,
  exportSubtitles,
  linesFromCues,
  MAX_TAKES,
  MIN_TAKES,
  overrun,
  parseDraft,
  removeTake,
  removeTiming,
  resplit,
  SCRIPT_STORAGE_KEY,
  SUBTITLE_EXPORT_NAME,
  type ScriptDraft,
  type ScriptSplit,
} from './script-model';
import {
  missingTakes,
  runTakes,
  takeInput,
  targetDuration,
  type TakeJob,
  type TakeProgress,
} from './script-generate';
import { resolveClips, resolveErrorKey, sendToResolve } from './resolve';
import { toTimelineWav } from './wav-export';
import { parseSubtitles, shortTime } from './subtitles';

function loadDraft(): ScriptDraft {
  try {
    return parseDraft(localStorage.getItem(SCRIPT_STORAGE_KEY));
  } catch {
    return parseDraft(null);
  }
}

export function ScriptPage() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const [draft, setDraft] = useState<ScriptDraft>(loadDraft);
  const [source, setSource] = useState(draft.source);
  const [progress, setProgress] = useState<TakeProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const run = useRef<AbortController | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const subtitleInput = useRef<HTMLInputElement | null>(null);
  const busy = progress !== null || exporting;

  useEffect(() => {
    try {
      localStorage.setItem(SCRIPT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* The draft still works for this session. */
    }
  }, [draft]);
  useEffect(
    () => () => {
      run.current?.abort();
      player.current?.pause();
    },
    [],
  );

  const lineNumber = (lineId: string) => draft.lines.findIndex((line) => line.id === lineId) + 1;

  async function generate(jobs: TakeJob[], before?: (current: ScriptDraft) => ScriptDraft) {
    if (!draft.profileId) {
      toast.error(t('script.no_voice'));
      return;
    }
    if (before) setDraft(before);
    const controller = new AbortController();
    run.current = controller;
    const settings = cloneSettingsStore.state;
    let current: TakeJob | null = null;
    try {
      await runTakes(
        jobs,
        (text, seed, duration) => takeInput(settings, draft, text, seed, duration),
        (input, signal) => generateClone(input, { signal }),
        {
          onProgress: (next) => {
            current = jobs[next.line - 1] ?? null;
            setProgress(next);
          },
          onTake: (lineId, take) => setDraft((value) => addTake(value, lineId, take)),
        },
        controller.signal,
      );
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted) {
        const number = current ? lineNumber((current as TakeJob).lineId) : 0;
        toast.error(t('script.failed', { number, error: describeError(error) }));
      }
    } finally {
      if (run.current === controller) run.current = null;
      setProgress(null);
    }
  }

  async function importSubtitles(file: File) {
    const cues = parseSubtitles(await file.text());
    if (!cues.length) {
      toast.error(t('script.import_failed', { name: file.name }));
      return;
    }
    const next = linesFromCues(draft, cues, file.name);
    setDraft(next);
    setSource(next.source);
  }

  function play(path: string) {
    player.current?.pause();
    if (playing === path) {
      setPlaying(null);
      return;
    }
    const audio = new Audio(audioUrl(path));
    player.current = audio;
    audio.onended = () => setPlaying(null);
    setPlaying(path);
    audio.play().catch((error: unknown) => {
      setPlaying(null);
      toast.error(describeError(error));
    });
  }

  /** Converts the takes to timeline WAVs and writes them to a folder the user picks. */
  async function writeExport(which: 'chosen' | 'all') {
    const plan = exportPlan(draft, which);
    if (!plan.length) {
      toast.error(t('script.nothing_to_export'));
      return null;
    }
    const files = [];
    for (const item of plan) {
      const response = await apiFetch('/audio/' + encodeURIComponent(item.take.audioPath)).catch(
        () => null,
      );
      if (!response?.ok) {
        toast.error(t('script.take_missing', { number: lineNumber(item.lineId) }));
        return null;
      }
      files.push({ name: item.name, data: toTimelineWav(await response.arrayBuffer()) });
    }
    // The matching subtitles: cue N belongs to clip line-N.
    const subtitles = exportSubtitles(draft);
    if (subtitles)
      files.push({ name: SUBTITLE_EXPORT_NAME, data: new TextEncoder().encode(subtitles) });
    const saved = await saveNativeFolder({
      files,
      labels: {
        title: t('script.export_title'),
        replaceMessage: t('script.replace_message'),
        replace: t('script.replace'),
        cancel: t('script.cancel'),
      },
    });
    if (saved === null) {
      toast.error(t('script.desktop_only'));
      return null;
    }
    return saved.canceled ? null : { plan, saved };
  }

  async function exportTakes(which: 'chosen' | 'all') {
    setExporting(true);
    try {
      const done = await writeExport(which);
      if (done) toast.success(t('script.exported', { count: done.plan.length }));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setExporting(false);
    }
  }

  /** Exports the chosen takes, then places them on the open Resolve timeline. */
  async function sendTakesToResolve() {
    setExporting(true);
    try {
      const done = await writeExport('chosen');
      if (!done?.saved.path) return;
      const clips = resolveClips(draft, done.plan, done.saved.written ?? []);
      const result = await sendToResolve(done.saved.path, clips);
      if (result.ok)
        toast.success(
          t('script.resolve_sent', {
            count: result.placed,
            track: result.tracks[0] ?? '',
            timeline: result.timeline ?? '',
          }),
        );
      else toast.error(t(resolveErrorKey(result.code), { files: result.files.join(', ') }));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setExporting(false);
    }
  }

  const pending = missingTakes(draft);
  const changed = source !== draft.source;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader>
        <h1>{t('script.title')}</h1>
        <div className="ms-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !draft.lines.some((line) => line.takes.length)}
            onClick={() => void exportTakes('chosen')}
          >
            <FolderDownIcon />
            {t('script.export_chosen')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !draft.lines.some((line) => line.takes.length)}
            onClick={() => void exportTakes('all')}
          >
            {t('script.export_all')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !draft.lines.some((line) => line.takes.length)}
            onClick={() => void sendTakesToResolve()}
            title={t('script.send_resolve_hint')}
          >
            <ClapperboardIcon />
            {t('script.send_resolve')}
          </Button>
        </div>
      </WorkspaceHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
          <section className="grid gap-3 rounded-xl border border-border/60 bg-card/40 p-4 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t('script.voice')}</span>
              <VoiceSelector
                value={draft.profileId ?? ''}
                onChange={(profileId: string) =>
                  setDraft((value) => ({ ...value, profileId: profileId || null }))
                }
                profiles={profiles.data ?? []}
                gallery={false}
                engineDefault={false}
                menuPortal
                disabled={busy}
                ariaLabel={t('script.voice')}
                placeholder={t('script.pick_voice')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('clone.language')}
              </span>
              <SearchableSelect
                value={draft.language}
                onChange={(language: string) => setDraft((value) => ({ ...value, language }))}
                options={LANGUAGES.map((value) => ({
                  value,
                  label: value === 'Auto' ? t('clone.auto') : value,
                }))}
                ariaLabel={t('clone.language')}
                menuPortal
                disabled={busy}
              />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('script.takes_per_line')}
              </span>
              <Input
                type="number"
                min={MIN_TAKES}
                max={MAX_TAKES}
                value={draft.takesPerLine}
                disabled={busy}
                className="w-24"
                onChange={(event) => {
                  const takes = Math.round(Number(event.target.value));
                  if (Number.isFinite(takes))
                    setDraft((value) => ({
                      ...value,
                      takesPerLine: Math.max(MIN_TAKES, Math.min(MAX_TAKES, takes)),
                    }));
                }}
              />
            </label>
          </section>

          <section className="flex flex-col gap-2">
            {draft.subtitles && (
              <div
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm"
                data-testid="subtitle-timing"
              >
                <CaptionsIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {t('script.timed_to', { name: draft.subtitles })}
                </span>
                <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={draft.fitToTiming}
                    disabled={busy}
                    onCheckedChange={(fitToTiming) =>
                      setDraft((value) => ({ ...value, fitToTiming }))
                    }
                  />
                  {t('script.fit_timing')}
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDraft((value) => removeTiming(value))}
                >
                  {t('script.remove_timing')}
                </Button>
              </div>
            )}
            <Textarea
              aria-label={t('script.script_text')}
              placeholder={t('script.placeholder')}
              value={source}
              disabled={busy}
              readOnly={!!draft.subtitles}
              title={draft.subtitles ? t('script.timed_locked') : undefined}
              rows={8}
              onChange={(event) => setSource(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={subtitleInput}
                type="file"
                accept=".srt,.vtt,text/vtt,application/x-subrip"
                className="hidden"
                data-testid="subtitle-file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void importSubtitles(file);
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => subtitleInput.current?.click()}
              >
                <CaptionsIcon />
                {t('script.import_subtitles')}
              </Button>
              {!draft.subtitles && (
                <>
                  <ToggleGroup
                    value={[draft.split]}
                    onValueChange={(value) => {
                      const split = value[0] as ScriptSplit | undefined;
                      if (split) setDraft((current) => resplit(current, source, split));
                    }}
                    disabled={busy}
                    size="sm"
                    spacing={0}
                    className="rounded-lg border border-border/50 bg-background/25 p-0.5"
                  >
                    <ToggleGroupItem value="lines">{t('script.split_lines')}</ToggleGroupItem>
                    <ToggleGroupItem value="sentences">
                      {t('script.split_sentences')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <Button
                    size="sm"
                    variant={changed ? 'default' : 'secondary'}
                    disabled={busy || !source.trim()}
                    onClick={() => setDraft((current) => resplit(current, source))}
                  >
                    <ListPlusIcon />
                    {t('script.apply')}
                  </Button>
                </>
              )}
              <div className="ms-auto flex items-center gap-2">
                {progress && (
                  <span role="status" className="text-xs text-muted-foreground">
                    {t('script.progress', { ...progress })}
                  </span>
                )}
                {progress ? (
                  <Button size="sm" variant="secondary" onClick={() => run.current?.abort()}>
                    <SquareIcon />
                    {t('script.stop')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy || !pending.length}
                    onClick={() => void generate(pending)}
                  >
                    <SparklesIcon />
                    {t('script.generate')}
                  </Button>
                )}
              </div>
            </div>
          </section>

          {draft.lines.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              {t('script.empty')}
            </p>
          ) : (
            <ol className="flex flex-col gap-2" aria-label={t('script.title')}>
              {draft.lines.map((line, index) => {
                const chosen = chosenTake(line);
                return (
                  <li
                    key={line.id}
                    className="rounded-xl border border-border/60 bg-card/30 p-3"
                    data-testid="script-line"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex shrink-0 flex-col text-xs font-medium tabular-nums text-muted-foreground">
                        {t('script.line_number', { number: index + 1 })}
                        {line.slot && (
                          <span className="font-normal" data-testid="line-slot">
                            {t('script.slot_label', {
                              start: shortTime(line.slot.start),
                              end: shortTime(line.slot.end),
                              seconds: (line.slot.end - line.slot.start).toFixed(1),
                            })}
                          </span>
                        )}
                      </span>
                      <p className="min-w-0 flex-1 text-sm">{line.text}</p>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={t('script.add_take')}
                        aria-label={t('script.add_take')}
                        disabled={busy}
                        onClick={() =>
                          void generate([
                            {
                              lineId: line.id,
                              text: line.text,
                              count: 1,
                              duration: targetDuration(draft, line),
                            },
                          ])
                        }
                      >
                        <PlusIcon />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={t('script.regenerate')}
                        aria-label={t('script.regenerate')}
                        disabled={busy}
                        onClick={() =>
                          void generate(
                            [
                              {
                                lineId: line.id,
                                text: line.text,
                                count: draft.takesPerLine,
                                duration: targetDuration(draft, line),
                              },
                            ],
                            (current) => clearTakes(current, line.id),
                          )
                        }
                      >
                        <RefreshCwIcon />
                      </Button>
                    </div>
                    {line.takes.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {line.takes.map((take, takeIndex) => {
                          const number = takeIndex + 1;
                          const isChosen = chosen?.id === take.id;
                          const over = overrun(line, take);
                          return (
                            <li
                              key={take.id}
                              className={cn(
                                'flex items-center rounded-lg border border-border/60 bg-background/40',
                                isChosen && 'border-primary/70 bg-primary/10',
                              )}
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={
                                  playing === take.audioPath
                                    ? t('script.stop_playback')
                                    : t('script.play_take', { number })
                                }
                                onClick={() => play(take.audioPath)}
                              >
                                {playing === take.audioPath ? <SquareIcon /> : <PlayIcon />}
                                {t('script.take_number', { number })}
                                {take.durationSeconds !== null && (
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {take.durationSeconds.toFixed(1)}s
                                  </span>
                                )}
                                {over !== null && over > 0 && (
                                  <span
                                    className="text-xs tabular-nums text-warning"
                                    data-testid="take-over"
                                  >
                                    {t('script.over', { seconds: over.toFixed(1) })}
                                  </span>
                                )}
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-pressed={isChosen}
                                title={t('script.use_take', { number })}
                                aria-label={t('script.use_take', { number })}
                                onClick={() =>
                                  setDraft((current) => chooseTake(current, line.id, take.id))
                                }
                              >
                                <CheckIcon className={isChosen ? 'text-primary' : 'opacity-40'} />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                title={t('script.remove_take', { number })}
                                aria-label={t('script.remove_take', { number })}
                                disabled={busy}
                                onClick={() =>
                                  setDraft((current) => removeTake(current, line.id, take.id))
                                }
                              >
                                <XIcon />
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
