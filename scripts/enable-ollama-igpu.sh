#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

service_dir=/etc/systemd/system/ollama.service.d
override_file="$service_dir/igpu.conf"
install -d -m 0755 "$service_dir"
cat > "$override_file" <<'UNIT'
[Service]
Environment="OLLAMA_IGPU_ENABLE=1"
UNIT
systemctl daemon-reload
systemctl restart ollama
sleep 2
journalctl -u ollama --since "2 minutes ago" --no-pager | rg -i 'Vulkan|inference compute|integrated GPU|GPU' || true
printf '\nOllama restarted with OLLAMA_IGPU_ENABLE=1. Run a meeting, then check `ollama ps` for GPU offload.\n'
