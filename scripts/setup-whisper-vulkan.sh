#!/usr/bin/env bash
set -euo pipefail

# Build whisper.cpp with Vulkan so the same app setup works on AMD and NVIDIA
# GPUs. Vulkan is selected at runtime from the installed vendor driver.
repo_dir="${WHISPER_CPP_SOURCE:-$HOME/.local/src/whisper.cpp}"
install_prefix="${WHISPER_INSTALL_PREFIX:-$HOME/.local}"
model_dir="${WHISPER_MODEL_DIR:-$HOME/.local/share/meeting-to-tickets}"
model_name="${WHISPER_MODEL:-small}"

for tool in git cmake c++; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    echo "On Ubuntu/Debian install build tools with: sudo apt install build-essential cmake git" >&2
    exit 1
  fi
done

if ! command -v vulkaninfo >/dev/null 2>&1; then
  echo "vulkaninfo is missing. Install Vulkan tools and the driver for your GPU." >&2
  echo "Ubuntu/Debian: sudo apt install vulkan-tools libvulkan-dev" >&2
  exit 1
fi

device_list="$(vulkaninfo --summary 2>&1)" || {
  echo "Vulkan could not find a usable GPU/driver:" >&2
  echo "$device_list" >&2
  echo "Install a Vulkan-capable NVIDIA or AMD driver, then rerun this script." >&2
  exit 1
}
gpu_names="$(printf '%s\n' "$device_list" | grep -Ei 'deviceName[[:space:]]*=' || true)"
hardware_names="$(printf '%s\n' "$gpu_names" | grep -Eiv 'llvmpipe|lavapipe|software' || true)"
if [[ -z "$hardware_names" ]]; then
  echo "Vulkan did not report a hardware GPU (it may only have a software renderer)." >&2
  echo "Install/enable the vendor driver and confirm vulkaninfo lists an AMD or NVIDIA device." >&2
  exit 1
fi
printf '%s\n' "$hardware_names"

if [[ ! -d "$repo_dir/.git" ]]; then
  mkdir -p "$(dirname "$repo_dir")"
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$repo_dir"
fi

build_dir="$repo_dir/build-vulkan"
cmake -S "$repo_dir" -B "$build_dir" \
  -DGGML_VULKAN=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$install_prefix"
cmake --build "$build_dir" --config Release --parallel "$(nproc)"
cmake --install "$build_dir"

mkdir -p "$model_dir"
model_path="$model_dir/ggml-$model_name.bin"
if [[ ! -s "$model_path" ]]; then
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1 && ! command -v wget2 >/dev/null 2>&1; then
    echo "Install curl or wget to download the Whisper model." >&2
    exit 1
  fi
  "$repo_dir/models/download-ggml-model.sh" "$model_name" "$model_dir"
fi

if [[ ! -x "$install_prefix/bin/whisper-cli" ]]; then
  echo "Vulkan build completed, but whisper-cli was not installed at $install_prefix/bin/whisper-cli" >&2
  exit 1
fi
if [[ ! -s "$model_path" ]]; then
  echo "Whisper model was not found at $model_path" >&2
  exit 1
fi

echo
echo "Whisper Vulkan setup is ready. The app will use:"
echo "  WHISPER_BIN=$install_prefix/bin/whisper-cli"
echo "  WHISPER_MODEL_PATH=$model_path"
echo "Set WHISPER_BIN and WHISPER_MODEL_PATH in .env.local if you used a custom install path."
echo "To verify GPU selection, run a transcription and look for 'using Vulkan0 backend' in Whisper output."
