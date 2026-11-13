# RedVoice: first test on the PC (milestone 3)

What to run on the test PC (Windows 11, Ryzen 7 7800X3D, Radeon RX 9070 XT) once the tools are installed. It answers the open AMD questions in `docs/MASTER-PROMPT_redvoice_v02.md`: does the Radeon get used, how fast is it, and which engine should be the default.

Use PowerShell. Lines starting with `#` are notes, not commands. Write down the results in the table at the end.

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

1. A prompt **Use your GPU for faster speech?** should appear. Note whether it does and which GPU and quant it names. Press **Use GPU** and accept the model licence.
2. Settings › Models › OmniVoice GGUF should show *Auto: (quant) (Vulkan – AMD Radeon RX 9070 XT)*.
3. Go to Clone, pick the demo voice and generate this sentence:
   *"The quick brown fox jumps over the lazy dog, and the editor cuts it right on the beat."*
4. Generate it three times. Note the time for the first and the third (the first includes loading). Watch **GPU** in Task Manager during generation.
5. Listen: note anything wrong with the sound.

## 6. Test B: CPU, to compare

Settings › Performance › Processing device: **CPU**. Generate the same sentence three times and note the times. Set it back to **Auto (recommended)** afterwards.

## 7. Test C: ROCm (optional, longer)

This reinstalls the Python environment with AMD's ROCm build of PyTorch, so the standard OmniVoice engine (not GGUF) can use the Radeon.

```powershell
# stop the app first (close the window, Ctrl+C in PowerShell)
$env:OMNIVOICE_TORCH_VARIANT = 'rocm'
bun run setup:api
bun run dev
```

In Settings › Models choose the standard **OmniVoice** engine, generate the same sentence three times and note the times. Settings › Performance › GPU acceleration should name the Radeon.

To go back to the normal setup:

```powershell
$env:OMNIVOICE_TORCH_VARIANT = 'cpu'
bun run setup:api
```

## Results to send back

| Item | Result |
|---|---|
| AMD driver version | |
| `vulkaninfo` present, lists the RX 9070 XT? | |
| GPU prompt appeared? GPU and quant it named | |
| Vulkan: first / third generation time | |
| Vulkan: GPU busy in Task Manager? | |
| CPU: first / third generation time | |
| ROCm: setup worked? first / third time | |
| Sound problems (any path) | |

If something fails, copy the error text and the last lines of Settings › Logs.
