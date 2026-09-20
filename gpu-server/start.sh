#!/usr/bin/env bash
set -e
cd /workspace/gpu-server
echo "=== Miya LTX GPU server ==="
nvidia-smi || true
python3 app.py
