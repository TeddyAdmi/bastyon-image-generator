#!/usr/bin/env bash
set -euo pipefail

cd /workspace/gpu-server

echo "=== Miya AI LTX GPU Server ==="
nvidia-smi || true

if [ ! -d /workspace/LTX-Video/.git ]; then
  echo "Installing official Lightricks/LTX-Video..."
  git clone --depth 1 https://github.com/Lightricks/LTX-Video.git /workspace/LTX-Video
fi

cd /workspace/LTX-Video

echo "Installing LTX inference dependencies..."
python3 -m pip install --upgrade pip
python3 -m pip install -e ".[inference-script]"

cd /workspace/gpu-server

echo "=== LTX files ==="
test -f /workspace/LTX-Video/inference.py
test -f /workspace/LTX-Video/configs/ltxv-2b-0.9.8-distilled.yaml
echo "LTX config: /workspace/LTX-Video/configs/ltxv-2b-0.9.8-distilled.yaml"

python3 app.py
