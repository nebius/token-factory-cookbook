#!/usr/bin/env python3
"""Dequantize the compressed-tensors W4A16 QAT checkpoint into a plain bf16 HF checkpoint (CPU only).

vLLM serves google/gemma-4-31B-it-qat-w4a16-ct (pack-quantized, int4 symmetric, group 32, bf16 scales).
A LoRA adapter has to be trained against exactly those effective weights, so every quantized Linear is replaced by
W = int4 * scale computed with compressed_tensors' own unpack/dequantize functions (the code transformers' compressed-
tensors integration uses to decompress), cross-checked against an independent pure-torch unpack on a few tensors.
Unquantized tensors (norms, embeddings, lm_head, vision tower, layer scalars) are copied bit-for-bit. The config is
copied without `quantization_config`, so transformers loads the result as an ordinary bf16 Gemma4ForConditionalGeneration.

Usage: python dequant_base.py --src gemma-4-31B-it-qat-w4a16-ct --dst base_bf16 [--workers 32]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

os.environ.setdefault('CUDA_VISIBLE_DEVICES', '')

import torch  # noqa: E402
from safetensors import safe_open  # noqa: E402
from safetensors.torch import save_file  # noqa: E402

SHARD_BYTES = 5 * 1024 ** 3


def ref_dequant(packed: torch.Tensor, scale: torch.Tensor, shape: tuple[int, int], group: int) -> torch.Tensor:
    """Independent reference: 8 int4 values per int32, low nibble first, stored with +8 offset (symmetric)."""
    rows, cols = shape
    p = packed.to(torch.int64) & 0xFFFFFFFF
    nib = torch.stack([(p >> (4 * i)) & 0xF for i in range(8)], dim=-1).reshape(rows, -1)[:, :cols]
    q = (nib - 8).to(torch.float32)
    s = scale.to(torch.float32).repeat_interleave(group, dim=1)[:, :cols]
    return (q * s).to(torch.bfloat16)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--dst', default='base_bf16')
    ap.add_argument('--workers', type=int, default=32)
    ap.add_argument('--check', type=int, default=6, help='number of tensors cross-checked against ref_dequant')
    args = ap.parse_args()
    torch.set_num_threads(max(1, os.cpu_count() // 2))

    from compressed_tensors.compressors.pack_quantized.helpers import unpack_from_int32
    from compressed_tensors.quantization import QuantizationArgs
    from compressed_tensors.quantization.lifecycle.forward import dequantize

    src, dst = Path(args.src), Path(args.dst)
    dst.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((src / 'config.json').read_text())
    qcfg = cfg.pop('quantization_config')
    assert qcfg['format'] == 'pack-quantized' and len(qcfg['config_groups']) == 1, qcfg.get('format')
    wargs = QuantizationArgs(**next(iter(qcfg['config_groups'].values()))['weights'])
    assert wargs.num_bits == 4 and wargs.symmetric and wargs.strategy == 'group', wargs
    group = wargs.group_size

    f = safe_open(str(src / 'model.safetensors'), 'pt')
    keys = list(f.keys())
    qbases = sorted(k[:-len('.weight_packed')] for k in keys if k.endswith('.weight_packed'))
    plain = [k for k in keys if not k.rsplit('.', 1)[-1].startswith('weight_') or k.endswith('.weight')]
    plain = [k for k in plain if not any(k == b + s for b in qbases for s in ('.weight_scale', '.weight_shape'))]
    print(f'{len(qbases)} quantized linears, {len(plain)} plain tensors; group={group}', flush=True)

    def deq(base: str) -> tuple[str, torch.Tensor]:
        packed = f.get_tensor(base + '.weight_packed')
        scale = f.get_tensor(base + '.weight_scale')
        shape = tuple(int(x) for x in f.get_tensor(base + '.weight_shape').tolist())
        q = unpack_from_int32(packed, wargs.num_bits, torch.Size(shape))
        w = dequantize(x_q=q, scale=scale, zero_point=None, args=wargs, dtype=torch.bfloat16)
        assert w.shape == torch.Size(shape) and w.dtype == torch.bfloat16
        return base + '.weight', w.contiguous()

    # cross-check the library path against the independent reference on a few tensors
    for base in qbases[:: max(1, len(qbases) // max(1, args.check))][: args.check]:
        name, w = deq(base)
        r = ref_dequant(f.get_tensor(base + '.weight_packed'), f.get_tensor(base + '.weight_scale'), tuple(w.shape), group)
        diff = (w.float() - r.float()).abs().max().item()
        print(f'[check] {name} {tuple(w.shape)} max|lib-ref|={diff:.3e} absmax={w.float().abs().max():.4f}', flush=True)
        assert diff == 0.0, f'dequant mismatch on {name}'

    t0 = time.time()
    out: dict[str, torch.Tensor] = {}
    with ThreadPoolExecutor(args.workers) as ex:
        for name, w in ex.map(deq, qbases):
            out[name] = w
    for k in plain:
        out[k] = f.get_tensor(k).contiguous()
    print(f'dequantized in {time.time() - t0:.0f}s; total {sum(t.numel() for t in out.values()) / 1e9:.2f}B params',
          flush=True)

    # shard + index (HF layout)
    names = sorted(out)
    shards, cur, cur_bytes = [], [], 0
    for n in names:
        b = out[n].numel() * out[n].element_size()
        if cur and cur_bytes + b > SHARD_BYTES:
            shards.append(cur)
            cur, cur_bytes = [], 0
        cur.append(n)
        cur_bytes += b
    shards.append(cur)
    weight_map, total = {}, 0
    for i, ns in enumerate(shards):
        fn = f'model-{i + 1:05d}-of-{len(shards):05d}.safetensors'
        save_file({n: out[n] for n in ns}, str(dst / fn), metadata={'format': 'pt'})
        for n in ns:
            weight_map[n] = fn
            total += out[n].numel() * out[n].element_size()
        print(f'wrote {fn} ({len(ns)} tensors)', flush=True)
    (dst / 'model.safetensors.index.json').write_text(json.dumps(
        {'metadata': {'total_size': total}, 'weight_map': weight_map}, indent=1))
    cfg['dtype'] = 'bfloat16'
    (dst / 'config.json').write_text(json.dumps(cfg, indent=2))
    for fn in ('chat_template.jinja', 'generation_config.json', 'processor_config.json', 'tokenizer.json',
               'tokenizer_config.json'):
        if (src / fn).exists():
            shutil.copy2(src / fn, dst / fn)
    (dst / 'DEQUANT_INFO.json').write_text(json.dumps(
        {'source': str(src), 'quantization_config_removed': {k: v for k, v in qcfg.items() if k != 'ignore'},
         'n_dequantized': len(qbases)}, indent=1))
    print(f'done -> {dst} ({total / 1e9:.1f} GB) in {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
