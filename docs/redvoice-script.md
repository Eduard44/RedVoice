# RedVoice: Script page

Turn a voice-over script into one clip per line, with several takes of each line to choose from, and export them as files ready for a video timeline.

## Use it

1. Open **Script** from the sidebar (under the voice group) or the home page.
2. Pick a **Voice** (a saved voice from Clone), the **Language** and the **Takes per line** (3 by default, up to 10).
3. Paste the script and press **Update lines**. Choose **Each line is a clip** (default) or **Each sentence is a clip**.
4. Press **Generate takes**. Each line gets its takes one after another, each with a different random seed, so the takes differ. **Stop** ends the run after the current take.
5. Press **Play** on a take to hear it, and the tick to use it. Without a pick, a line uses its first take.
6. Per line: **+** adds one more take, the circular arrow throws away that line's takes and makes new ones. Other lines are not touched.
7. **Export chosen takes** writes one file per line; **Export all takes** writes every take. Pick a folder; if files with the same names exist, RedVoice asks before replacing them.

## Timed to subtitles

1. Press **Import subtitles** and pick an `.srt` or `.vtt` file. Each subtitle becomes a line that keeps its start and end time; the time slot shows under the line number.
2. With **Fit takes to subtitle timing** on (the default), every take asks the engine for exactly the slot's length. OmniVoice renders speech to that length, so a 2.5 s subtitle gets a 2.5 s take. Engines that ignore a target length are marked: a take that runs past its slot shows how much too long it is (up to 50 ms over still counts as fitting).
3. Export as usual. Next to the clips RedVoice writes `voice-over.srt`: cue N belongs to clip `line-N`, starts where its subtitle starts and lasts as long as the exported clip.
4. While the lines come from subtitles, the script box is read-only. **Remove timing** keeps the lines and takes and turns them back into a typed script.

## Send to DaVinci Resolve

**Send to Resolve** exports the chosen takes like **Export chosen takes**, then places them on the timeline that is open in DaVinci Resolve Studio on the same computer.

Before the first send, in Resolve: **Preferences › System › General › External scripting using › Local**, then restart Resolve. Open the project and the timeline the voice-over is for. Resolve's free version does not allow outside scripts; this needs Resolve Studio.

What happens:

- The clips are imported into a `RedVoice` bin in the media pool. A file that is already in that bin is refreshed rather than imported twice, so a regenerated take shows its new audio.
- A new mono audio track named `RedVoice VO` is added at the bottom; existing tracks are never changed. If a clip would overlap the one before it (a take longer than its subtitle), it goes on a second new track, `RedVoice VO 2`, instead of cutting it.
- Lines from subtitles start at their subtitle's time, counted from the start of the timeline. Lines of a typed script follow each other from the playhead, half a second apart.
- If something is missing, RedVoice says what: Resolve not installed, not open or not set to allow scripts, no project or timeline, or which files Resolve refused. The clips stay in the folder you picked either way.

RedVoice talks to Resolve through Blackmagic's own scripting files, which Resolve installs. It looks for them in Blackmagic's standard folders; set `RESOLVE_SCRIPT_API` and `RESOLVE_SCRIPT_LIB` (as in Resolve's scripting README) if Resolve is installed somewhere else. The connection runs in a separate helper process, so a problem in Resolve cannot crash RedVoice.

## Files

- Names: `line-03_take-02.wav`, numbered by position in the script and padded so they sort in order (`line-120_...` past 99 lines).
- Format: WAV, 48 kHz, 24-bit PCM, the format video timelines use. The model renders at 24 kHz; RedVoice resamples with a band-limited filter and adds dither below the 24-bit step.
- Takes use the Clone page's quality settings (sampling steps, guidance, denoise and so on).

## Good to know

- Editing the script and pressing **Update lines** keeps the takes of every line whose text did not change.
- The script, picks and take list are saved on this computer and come back when you reopen the page. The audio lives in RedVoice's generation history; if history pruning has removed a take, export names the line to regenerate.
- Exporting to a folder needs the desktop app.

## Code

`electron/src/renderer/src/features/script/` (page, model, generation runner, WAV export, Resolve send), `electron/src/main/save-folder.ts` (the folder save behind `files.saveToFolder`), and for Resolve `backend/api/routers/resolve.py` with `backend/services/resolve_timeline.py`.
