# RedVoice: first test on the PC (milestone 3)

What to run on the test PC (Windows 11, Ryzen 7 7800X3D, Radeon RX 9070 XT) once the tools are installed. It answers the open AMD questions in `docs/MASTER-PROMPT_redvoice_v02.md`: does the Radeon get used, how fast is it, and which engine should be the default.

Use PowerShell. Lines starting with `#` are notes, not commands. Write down the results in the table at the end.

> **Easier way to just use RedVoice:** install it with the Windows installer (`docs/redvoice-install-windows.md`). That needs none of the tools below, and the installer already contains the Vulkan speech engine. The steps in this plan run RedVoice from its source code, which is what the timing script and the ROCm test (Test C) need. Tests A, B and D can also be done by ear in the installed app.

## 1. Install the tools (once)

```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
powershell -c "irm bun.sh/install.ps1 | iex"
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Also install the **Visual Studio 2022 Build Tools** with the **Desktop development with C++** workload: https://visualstudio.microsoft.com/visual-cpp-build-tools/

Close and reopen PowerShell, then sign in to GitHub once:

```powershell
gh auth login
```

## 2. Check the graphics driver

Update the AMD Adrenalin driver first. Then:

```powershell
vulkaninfo --summary
```

- It lists **AMD Radeon RX 9070 XT** with `PHYSICAL_DEVICE_TYPE_DISCRETE_GPU`: good, note the driver version.
- "vulkaninfo is not recognized": note that down. The app then cannot confirm the GPU and will not offer it. Install the Vulkan SDK runtime tools from https://vulkan.lunarg.com/ and try again.

## 3. Get RedVoice and its speech engine

```powershell
cd $HOME
git clone https://github.com/Eduard44/RedVoice.git
cd RedVoice
node electron/scripts/node-version.mjs

# The Vulkan speech engine is built by GitHub, not stored in the repo.
$run = gh run list --repo Eduard44/RedVoice --workflow build-omnivoice-tts.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId'
gh run download $run --repo Eduard44/RedVoice --name omnivoice-tts-windows-x86_64 --dir bin
dir bin
```

`bin` should now hold `omnivoice-tts-windows-x86_64.exe`, `ggml-vulkan.dll` and `checksums.sha256`. If `$run` is empty, the build is older than 90 days and has expired: open the repo's **Actions** tab, pick **Build omnivoice-tts**, press **Run workflow**, wait for it to finish and run the two lines again.

## 4. Start the app

```powershell
bun install
bun run setup:api
bun run dev
```

The first setup downloads the Python packages (several GB) and takes a while. RedVoice asks before it downloads any voice model.

## 5. Test A: Radeon through Vulkan

1. A prompt **Use your GPU for faster speech?** should appear. Note whether it does and which GPU and quant it names. Press **Use GPU** and accept the model licence. Let the download finish.
2. Settings › Models › OmniVoice GGUF should show *Auto: (quant) (Vulkan – AMD Radeon RX 9070 XT)*.
3. Leave the app running. In a **second** PowerShell window, in the RedVoice folder, run:

   ```powershell
   uv run --no-project python scripts/redvoice/measure_tts.py --engine omnivoice-gguf --save-dir takes-vulkan
   ```

   It speaks a test sentence three times and prints a table. The first run includes loading the model; the others are the working speed. **RTF** is seconds of work per second of speech: below 1 is faster than real time. Watch **GPU** in Task Manager while it runs.
4. Listen to the files in `takes-vulkan` and note anything wrong with the sound.

## 6. Test B: CPU, to compare

Settings › Performance › Processing device: **CPU**. On CPU the GGUF engine uses its smaller CPU model (Q4_K_M): if Settings › Models › OmniVoice GGUF shows it as not downloaded, download it there first. Then:

```powershell
uv run --no-project python scripts/redvoice/measure_tts.py --engine omnivoice-gguf --save-dir takes-cpu
```

Set it back to **Auto (recommended)** afterwards.

## 7. Test C: ROCm (optional, longer)

This reinstalls the Python environment with AMD's ROCm build of PyTorch, so the standard OmniVoice engine (not GGUF) can use the Radeon.

```powershell
# stop the app first (close the window, Ctrl+C in PowerShell)
$env:OMNIVOICE_TORCH_VARIANT = 'rocm'
bun run setup:api
bun run dev
```

Settings › Performance › GPU acceleration should name the Radeon. In the second window:

```powershell
uv run --no-project python scripts/redvoice/measure_tts.py --engine omnivoice --save-dir takes-rocm
```

To go back to the normal setup:

```powershell
$env:OMNIVOICE_TORCH_VARIANT = 'cpu'
bun run setup:api
```

If the script says it cannot reach RedVoice, check the app is running. If Windows reserved port 3900, RedVoice picked the next free port: add `--base http://127.0.0.1:3901` (or the port shown in the app's logs).

## 8. Test D: Send to Resolve

1. In DaVinci Resolve Studio: **Preferences › System › General › External scripting using › Local**, then restart Resolve.
2. Open a test project with a timeline (any frame rate; 23.976 or 25 is fine). Put the playhead somewhere after the start.
3. In RedVoice, open **Script**, paste two or three short lines, generate takes, then press **Send to Resolve** and pick a new empty folder.
4. In Resolve, check: a `RedVoice` bin with the clips, a new `RedVoice VO` audio track, the clips one after another from the playhead, nothing else on the timeline changed.
5. Repeat with an imported `.srt`: each clip should start exactly where its subtitle starts. Turn on Resolve's subtitle track or import the same `.srt` there to compare.
6. Note whether any clip's last syllable is cut, or if there is extra silence at the end.

## Results to send back

| Item | Result |
|---|---|
| AMD driver version | |
| `vulkaninfo` present, lists the RX 9070 XT? | |
| GPU prompt appeared? GPU and quant it named | |
| Vulkan: the script's summary line | |
| Vulkan: GPU busy in Task Manager? | |
| CPU: the script's summary line | |
| ROCm: setup worked? the script's summary line | |
| Sound problems (any path) | |
| Resolve: version, clips in the right place? cut endings? any error text | |

Paste the three summary lines the script printed, plus the table above. If something fails, copy the error text and the last lines of Settings › Logs.
