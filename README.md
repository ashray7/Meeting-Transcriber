# Meeting-to-Tickets

Local-first meeting transcription and ticket draft review. The default provider uses the Ollama model `qwen3:8b` (Q4_K_M), with `llama3.2:latest` and other local models selectable in Settings for meeting analysis and `whisper.cpp` with its Vulkan backend and the `small` model for transcription. Vulkan supports both AMD and NVIDIA GPUs when a working Vulkan driver is installed. No API key is needed.

## Requirements

- Node.js 20+
- Ollama running at `http://localhost:11434`, with `qwen3:8b` available (`ollama pull qwen3:8b`)
- FFmpeg available on `PATH`
- A Vulkan-capable AMD or NVIDIA graphics driver, and `whisper.cpp` built with Vulkan (setup below)
- The `ggml-small.bin` Whisper model (downloaded by the setup script if missing)

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. Uploaded files and meeting/task records stay on this machine in `uploads/` and `data/store.json`.

## Project profiles

Open **Project profiles** in the sidebar to add a project name, description, product surfaces, work areas, project-specific guidance, and reference documents. You can upload text files (`.md`, `.mdx`, `.txt`, `.json`, `.yaml`, `.yml`, `.xml`, `.toml`, `.csv`, plus common source/test formats such as `.ts`, `.py`, and `.sql`) or paste content. PDFs and binary office documents are not parsed. Profiles are stored locally in `data/projects.json`, which is ignored by Git.

Choose a profile when creating a meeting. Its categories and guidance, plus document excerpts relevant to the transcript, are provided to the analysis model. Generated tasks include a product surface, work area, and project document references when the evidence supports them. The meeting stores a snapshot of its selected profile so edits to the profile do not alter past meeting context.

## GPU acceleration

Whisper uses `whisper.cpp`'s cross-vendor Vulkan backend. It selects a device from the installed Vulkan driver at runtime, so the same build works with AMD and NVIDIA GPUs. Install the GPU vendor's Vulkan-capable driver first. On Ubuntu/Debian, install the build tools and Vulkan SDK headers, then run the setup script:

```bash
sudo apt install build-essential cmake git libvulkan-dev vulkan-tools
vulkaninfo --summary
./scripts/setup-whisper-vulkan.sh
```

`vulkaninfo --summary` should list your graphics card. If it fails or only lists a software renderer, fix the GPU driver before building. The script builds upstream `whisper.cpp` with `GGML_VULKAN=ON`, installs `whisper-cli` under `~/.local`, and downloads the configured Whisper model if it is missing. It uses Vulkan on both AMD and NVIDIA; CUDA or ROCm SDKs are not required for Whisper.

Ollama detects and uses compatible NVIDIA GPUs through its CUDA backend and supported AMD GPUs through ROCm; it can also use Vulkan for additional GPU devices. The app requests GPU offload, while Ollama chooses the available backend and falls back according to its hardware/driver support. The `scripts/enable-ollama-igpu.sh` helper is an optional AMD integrated-GPU workaround for this machine; it is not needed for NVIDIA and is not part of the generic Vulkan setup. Check `ollama ps` during analysis to see the actual processor allocation.

Input recordings are converted to mono 16 kHz WAV before transcription. Check Whisper's runtime output for `using Vulkan0 backend` to confirm GPU acceleration.

## Providers

- `AI_PROVIDER=ollama`: local Ollama chat model plus local Whisper. Choose the model in Settings; the selection is saved locally. Configure `OLLAMA_BASE_URL`, `OLLAMA_NUM_CTX`, `WHISPER_BIN`, `WHISPER_MODEL`, `WHISPER_MODEL_PATH`, and `WHISPER_USE_GPU` as needed.
- `AI_PROVIDER=openai`: OpenAI transcription and analysis. Requires `OPENAI_API_KEY`; model settings are configurable in `.env.local`.
- `AI_PROVIDER=demo`: sample transcript and analysis for preview only; uploaded audio is not transcribed.

Analysis output is JSON validated with Zod before it is stored. The model classifies candidate intent as committed, proposed, rejected, cancelled, deferred, or unclear; only committed candidates become ticket drafts. Later rejection overrides an earlier suggestion, and relevant rejections are recorded as meeting decisions. Processing stages and errors are saved with each meeting. This MVP uses local filesystem storage and is intended to run as a local Node server.
