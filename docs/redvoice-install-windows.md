# RedVoice: Windows installer

How to build the RedVoice installer for Windows (x64), install it, and what to expect. No programming tools are needed on the PC: the installer is built on GitHub.

## Build it

1. Open the repository on GitHub, then **Actions** › **RedVoice Windows installer** (left column).
2. Press **Run workflow**, keep the branch `main`, and press the green **Run workflow** button.
   - Leave **Also put the installer on the Releases page** off for a private build.
   - Turn it on to also get a public download link on the Releases page (see [Releases page](#releases-page)).
3. Wait until the run shows a green tick. It takes roughly 40 to 60 minutes: it builds the speech runtime, builds the app, packs the installer, then starts the packed app once on a clean Windows machine and lets it install its Python environment, so a broken installer fails here and not on your PC.
4. Open the finished run and scroll to **Artifacts**. Download **RedVoice-windows-x64-installer**. It is a zip with:
   - `RedVoice-<version>-win-x64.exe`, the installer
   - `RedVoice-<version>-win-x64.exe.sha256`, its checksum

Artifacts need a signed-in GitHub account and are kept for 30 days. Run the workflow again whenever you want a fresh build.

## Install it

1. Unzip the download and run `RedVoice-<version>-win-x64.exe`.
2. Windows shows **Windows protected your PC** because the installer is not code-signed. Press **More info**, then **Run anyway**. Only do this for a file you built from your own repository.
3. The wizard installs for your user account (no administrator rights) and lets you pick the folder.
4. Start RedVoice. On first start it sets itself up: it downloads its Python environment and FFmpeg, and later the speech model you pick. This needs the internet and about 10 GB of free disk. After that RedVoice works offline.

If Windows 11 **Smart App Control** is on, it can block the downloaded Python files even after the installer ran. `docs/install/troubleshooting.md` has the steps.

## Where things are

| What | Folder |
|---|---|
| The app | The folder picked in the wizard (default `%LOCALAPPDATA%\Programs\RedVoice`) |
| App settings and the downloaded Python environment | `%APPDATA%\RedVoice` (the environment is in `runtime`) |
| Voices, projects, generated audio | `%APPDATA%\OmniVoice` |
| Downloaded speech models | `%LOCALAPPDATA%\OmniVoice\hf_cache` |

The `OmniVoice` folders keep their upstream names on purpose. If VoiceStudio is installed on the same PC, both apps share voices, projects and models there, and they share one installation entry in Windows (same app id), so install only one of the two.

## Uninstall

Use **Settings › Apps › Installed apps › RedVoice › Uninstall**. The uninstaller asks whether to also delete the downloaded Python environment and models to free disk space; the default is to keep them. Voices and projects are never deleted by the uninstaller.

## Releases page

With **Also put the installer on the Releases page** on, the same installer is attached to a prerelease named `RedVoice <version> (build N)` with the tag `redvoice-<version>-build.N`. Anyone can then download it without signing in. The release text states that RedVoice is a modified fork of VoiceStudio under AGPL-3.0, which commit it was built from, and the checksum.

Delete a release on its page (**Delete**, then delete its tag) when you no longer want the link.

## Limits

- The installer is unsigned, so the SmartScreen warning stays until a signing certificate is added.
- Update checks are switched off in RedVoice. To update, build and run a newer installer; it replaces the old version and keeps your data.
- The version number is VoiceStudio's (`package.json`); the build number tells RedVoice builds apart.
- The installer still adds the upstream `voicestudio` terminal command to PATH. That command has not been adapted to RedVoice and does not find the RedVoice app on its own; RedVoice does not need it.
- Only Windows x64 is built here. The upstream workflows for other systems (`electron-build.yml`, `electron-release.yml`) are unchanged; `electron-release.yml` still expects VoiceStudio file names and is not used by RedVoice.

## Code

`.github/workflows/redvoice-windows.yml` (the steps mirror the Windows x64 leg of `electron-build.yml`), `electron/electron-builder.config.mjs`, `electron/packaging/cli-installer.nsh` (PATH step and the uninstall question).
