#!/usr/bin/env bash
# Run with bash setup.sh inside the mobile repair recipe on a CUDA-enabled Jupyter host.
set -eu
python -m venv --system-site-packages .venv
py=.venv/bin/python
if ! "$py" -c 'import torch; assert torch.__version__.startswith("2.11.0") and torch.version.cuda == "12.8"' >/dev/null 2>&1; then
  "$py" -m pip install 'torch==2.11.0+cu128' --index-url https://download.pytorch.org/whl/cu128
fi
"$py" -c 'import torch; assert torch.cuda.is_available(), "Select a GPU Devlab and check nvidia-smi before continuing"'
"$py" -m pip install --no-cache-dir 'torch==2.11.0' 'transformers==5.24.0' 'trl==1.15.0' \
  'datasets==4.8.5' 'peft==0.22.0' 'bitsandbytes==0.50.2' 'accelerate==1.16.0' \
  'huggingface_hub==1.33.0' sentencepiece protobuf hf_transfer diffusers tyro structlog msgspec einops cut_cross_entropy tiktoken json5
"$py" -m pip install --no-cache-dir --no-deps 'torchao==0.18.0' \
  'git+https://github.com/unslothai/unsloth-zoo@33f29031ad18a0da5c3bb1d70c94a8268da549bf' \
  'git+https://github.com/unslothai/unsloth@16c90963ec54f0660edd2ba39cbd0582389cbd2a'
"$py" -c 'from unsloth import FastModel; print("Environment ready")'
