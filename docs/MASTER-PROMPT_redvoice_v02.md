# RedVoice master prompt (v02, 2026-11-13)

The project brief for RedVoice. It replaces v01 (kept in `docs/` for reference): it adds what was built in milestones 1 and 2, corrects the AMD facts, and records the working rules learned so far.

## What RedVoice is

RedVoice is a public fork of [VoiceStudio](https://github.com/debpalash/VoiceStudio) (AGPL-3.0). It is a local, offline voice cloning and text-to-speech desktop app aimed at video editors, and it must run well on AMD Radeon GPUs, not only NVIDIA.

It is a separate version of VoiceStudio, similar but not identical, kept as an independent line of the project.

## Owner and test machine

- The owner is a video editor and motion designer (DaVinci Resolve Studio, After Effects 2026). Not a programmer: explain choices in plain language and keep steps short.
- Test PC: Windows 11 Pro, AMD Ryzen 7 7800X3D, AMD Radeon RX 9070 XT (RDNA 4, 16 GB VRAM). No NVIDIA hardware is available for testing.
- As of 2026-11-11 the PC has no git, GitHub CLI, Bun/Node or real Python (only the Store stub). The owner agreed to install them with winget after 2026-11-16. Until then, work happens in the GitHub repo only and nothing can be run on the GPU.

## Decisions already made

| Topic | Decision |
|---|---|
| Code base | Reuse VoiceStudio source (fork), do not rewrite from scratch |
| Repo | Public GitHub fork named `RedVoice` |
| License | Stays AGPL-3.0-only (required by the fork) |
| Platform focus | Windows desktop app first. Website version later |
| v1 feature | Voice cloning + TTS |
| Language | English only in v1 |
| Other VoiceStudio features (dubbing, dictation, audiobooks, mobile) | Keep the code, hide them in the UI behind a setting or flag |
| Online parts (Pro, Cloud, accounts, update checks) | Disabled. Fully offline; only model downloads use the internet, and only after asking |
| Look | Dark, like Resolve: neutral dark panels, red accent |
| Speed vs quality | Quality first by default, plus a faster draft mode |
| Name | RedVoice |

## What makes RedVoice different

1. **AMD first.** The app detects the GPU vendor and picks a working, accelerated path on Radeon without manual setup.
2. **Script to per-line takes.** Paste a script; each line becomes its own clip with several takes to choose from. Files are clearly named (`line-03_take-02.wav` style) and regenerating one line does not touch the others.
3. **Voice timed to subtitles.** Import an SRT; generate speech for each subtitle that fits its time slot, and export clips plus a matching SRT.
4. **Send VO to Resolve timeline.** One click places the chosen takes on an audio track in the open DaVinci Resolve Studio project, at the right timecodes, using Resolve's Python scripting API.

After Effects hand-off was considered and left out of v1.

## AMD work: what exists and what to verify

Checked in the code on 2026-11-13 (v01 said less was there than there is):

- **Vulkan path (OmniVoice GGUF).** Already built upstream. On a PC whose PyTorch has no GPU, with a verified Vulkan adapter (`vulkaninfo`) and the bundled `omnivoice-tts` runtime with its Vulkan module, the app shows a one-time *Use your GPU for faster speech?* offer (`backend/engines/omnivoice_gguf/gpu_offer.py`, `electron/src/renderer/src/components/gpu-offer.tsx`). Accepting checks the model licence, switches the TTS engine to `omnivoice-gguf` and downloads the weights; Settings › Performance › GPU acceleration has the same action. This one click is also the "ask before downloading" step, so it stays.
- **ROCm path (PyTorch engines).** `scripts/windows-rocm-recipe.json` installs AMD's ROCm 7.2.1 with torch 2.9.1 on Windows and lists `gfx1201` (RX 9070 XT) among its targets. It is opt-in: `OMNIVOICE_TORCH_VARIANT=rocm` before `bun run setup:api` (see `docs/install/windows-rocm.md`). Upstream reports testing only on RX 5700 and RX 6700 XT.
- **Runtime for a source checkout.** A checkout does not contain the `omnivoice-tts` binary. It comes from the `build-omnivoice-tts.yml` workflow (artifact `omnivoice-tts-windows-x86_64`, kept 90 days) and is unpacked into `bin/`.
- PyTorch still installs from the CUDA index by default and falls back to CPU without NVIDIA.

Not yet verified on the RX 9070 XT (all need the test PC):

- Whether `vulkaninfo` is present after installing the AMD driver, and whether the GPU offer appears.
- Speed and quality of the Vulkan path compared with CPU, and which quant it picks on 16 GB.
- Whether the ROCm 7.2.1 recipe installs and runs on `gfx1201`, and its speed for the PyTorch OmniVoice engine.
- Whether ONNX Runtime with DirectML is worth adding for the ONNX engines (lower priority).

Plan: follow `docs/redvoice-pc-test-plan.md` on the test PC, then decide the default engine from the measurements. Do not claim an AMD path works until it has run there.

## Rules for working on this repo

- Read the repository's own contributor rules (the instruction files in the repository root) first and follow their conventions.
- Keep the AGPL-3.0 license, all existing copyright notices and `LICENSE-NOTICE.md`. State in the README that RedVoice is a modified fork of VoiceStudio and summarize what changed.
- Rename user-facing branding to RedVoice (app name, window title, icons, installer names). Do not use the VoiceStudio name or logo as RedVoice's own branding.
- Remove or disable calls to VoiceStudio servers: installer scripts, update checks, Pro/Cloud/account endpoints, telemetry if any.
- Hidden features stay in the code and should remain buildable, so upstream changes can still be merged. Prefer small, isolated changes over large rewrites for the same reason.
- NVIDIA and CPU support must keep working; AMD is added, nothing is taken away.
- Everything stays editable and clearly named.
- Report honestly: if something was not tested on real hardware, say so.

Learned while working (milestones 1 and 2):

- Commits and pull requests carry only the owner's git identity: no extra co-author, attribution or tool lines and no session links. The repo's `commit-identity` check enforces this.
- The VoiceStudio contributor agreement (CLA) bot comments on every pull request and sets it to draft. The owner does not sign it. Mark the pull request ready and merge once the real checks pass.
- Run the formatter only on files you changed. Formatting a whole folder rewrites upstream files and makes later upstream merges harder.
- The product name lives in `config/app.json`. Interface texts keep the upstream catalogs; `config/product-name.mjs` swaps VoiceStudio for RedVoice when a text is shown, except where it names upstream's own services (Pro, Cloud, accounts, donations).
- `onlineServices: false` in `config/app.json` switches off accounts, Cloud, update checks and analytics, and hides Pro, star count and donate links.
- Settings › General › Show all features brings back the hidden workspaces. Smoke tests run with it on.
- Data folders, the `omnivoice` package, `OMNIVOICE_*` variables and the app id keep their upstream names on purpose.
- Many checks hard-code the product name (store metadata, Snap, Nix, AUR, smoke tests, the mobile OpenAPI contract). Expect to update them when names change.

## Progress

| Milestone | Status |
|---|---|
| 1. Repo setup | Done (PR #1) |
| 2. Rebrand and trim the UI | Done (PRs #2, #3, #4): RedVoice name, RV placeholder logo, Roboto font, dark red palette, v1 view, online services off |
| 3. AMD path | Code paths exist upstream (see above). `scripts/redvoice/measure_tts.py` times each path; measuring on the test PC is next |
| 4. Script to per-line takes | Built: Script page, 3 takes per line by default, export as `line-NN_take-NN.wav` (48 kHz 24-bit) to a folder (`docs/redvoice-script.md`). Needs a listening test on the PC |
| 5. Voice timed to subtitles | Built into the Script page: import SRT/VTT, takes fit each slot, export clips plus a matching `voice-over.srt`. Needs a listening test on the PC |
| 6. Send VO to Resolve timeline | Built: **Send to Resolve** on the Script page exports the chosen takes, imports them into a `RedVoice` bin and places them on a new `RedVoice VO` track (subtitle times, or one after another from the playhead). Needs a test with Resolve Studio on the PC |
| 7. Windows installer build | Not started; release workflows still expect VoiceStudio file names |

## Milestones

1. **Repo setup**: fork exists, this prompt is in `docs/`, README states the fork relationship.
2. **Rebrand and trim the UI**: RedVoice name and dark red theme, non-v1 features hidden, online parts disabled.
3. **AMD path**: GPU vendor detection, automatic Vulkan GGUF default on Radeon, ROCm investigation, results measured on the RX 9070 XT (needs the test PC, after 2026-11-16).
4. **Script to per-line takes.**
5. **Voice timed to subtitles (SRT).**
6. **Send VO to Resolve timeline.**
7. **Windows installer build** for RedVoice.

Milestones 1, 2 and the code for 4 to 6 can be done from the web. Milestone 3 testing and any real audio check need the PC.

## Open questions

- Which engine is the quality-first default for English cloning on AMD (decide after measuring in milestone 3).
- Whether to keep the one-click GPU offer or switch engines automatically on a Radeon (downloads must still be asked for).
- Should RedVoice keep pulling updates from VoiceStudio regularly, or drift apart over time?
- Website version: scope and hosting, to be discussed after the desktop app works.
