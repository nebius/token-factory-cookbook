#!/usr/bin/env python3
"""PEFT LoRA SFT of Gemma 4 31B (dequantized QAT bf16 base) on render.py rows, FSDP2 across N GPUs.

Launch (8 GPUs):
  accelerate launch --multi_gpu --num_processes 8 train_lora.py --base base_bf16 --train train.jsonl --eval '' \
      --out runs/r16 --epochs 2 --save-every-epoch --warmup-steps 10 --max-len 24576 --ckpt-every-min 5 --resume
  (torchrun --nproc_per_node 8 works the same way.)

Design
- Base: bf16 weights from dequant_base.py, so the adapter is fitted to the weights vLLM serves.
- LoRA r=16, alpha=32, dropout=0.05 on q/k/v/o/gate/up/down of the LANGUAGE model only (vision/audio towers dropped).
  Adapter weights are fp32 masters; FSDP2 all-gathers them in bf16 (MixedPrecisionPolicy) and reduces grads in fp32.
- One packed-free sequence per micro-batch (batch 1/GPU, packing off), loss only where labels != -100, averaged over
  all label tokens of the global step. Logits are computed only at labeled positions, in checkpointed chunks
  (262k vocab x 24k tokens would otherwise need ~25 GB), with Gemma's final-logit softcapping.
- Attention: 'chunked' (default) = SDPA mem-efficient kernel; sliding-window layers attend in 1024-query blocks to
  their 1024-key window (exact, ~10x less work than a dense masked 24k^2 SDPA), global layers use causal SDPA.
  Requires batch 1 without padding. '--attn sdpa' uses HF's stock SDPA path (reference / check).
- Gradient checkpointing per decoder layer. Saves adapter_config.json + adapter_model.safetensors only.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import time
from pathlib import Path

import torch
import torch.distributed as dist
import torch.nn as nn
import torch.nn.functional as F
import torch.utils.checkpoint

TARGET_REGEX = r'model\.language_model\.layers\.\d+\.(self_attn\.(q_proj|k_proj|v_proj|o_proj)|mlp\.(gate_proj|up_proj|down_proj))'
TARGET_NAMES = ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj']


# ------------------------------------------------------------------------------------------------ attention
def chunked_sdpa_attention(module, query, key, value, attention_mask, dropout=0.0, scaling=None, sliding_window=None,
                           **kwargs):
    """HF attention-interface function. query [B,H,L,D], key/value [B,Hkv,L,D] -> ([B,L,H,D], None)."""
    assert query.shape[0] == 1, 'chunked attention assumes batch size 1 without padding'
    n_rep = query.shape[1] // key.shape[1]
    if n_rep > 1:
        b, h, s, d = key.shape
        key = key[:, :, None].expand(b, h, n_rep, s, d).reshape(b, h * n_rep, s, d)
        value = value[:, :, None].expand(b, h, n_rep, s, d).reshape(b, h * n_rep, s, d)
    L = query.shape[2]
    W = sliding_window
    if not W or L <= W:
        out = F.scaled_dot_product_attention(query, key, value, is_causal=True, scale=scaling)
    else:
        outs = []
        for s0 in range(0, L, W):
            s1 = min(L, s0 + W)
            k0 = max(0, s0 - W + 1)
            qi = torch.arange(s0, s1, device=query.device)[:, None]
            kj = torch.arange(k0, s1, device=query.device)[None, :]
            m = (kj <= qi) & (qi - kj < W)   # HF sliding_window_overlay: kv_idx > q_idx - W
            outs.append(F.scaled_dot_product_attention(query[:, :, s0:s1], key[:, :, k0:s1], value[:, :, k0:s1],
                                                       attn_mask=m, scale=scaling))
        out = torch.cat(outs, dim=2)
    return out.transpose(1, 2).contiguous(), None


def register_attention() -> None:
    from transformers import AttentionInterface
    from transformers.masking_utils import AttentionMaskInterface
    AttentionInterface.register('chunked_sdpa', chunked_sdpa_attention)
    AttentionMaskInterface.register('chunked_sdpa', lambda *a, **k: None)   # masks are implicit (causal / window)


# ------------------------------------------------------------------------------------------------ model
class LossModel(nn.Module):
    """Root FSDP unit: runs Gemma4Model and a chunked, checkpointed CE on labeled positions only."""

    def __init__(self, peft_model, logit_chunk: int):
        super().__init__()
        self.peft = peft_model
        self.logit_chunk = logit_chunk
        base = peft_model.base_model.model
        self.softcap = base.config.get_text_config().final_logit_softcapping

    def _chunk_loss(self, h, tgt):
        logits = self.peft.base_model.model.lm_head(h).float()
        if self.softcap:
            logits = torch.tanh(logits / self.softcap) * self.softcap
        return F.cross_entropy(logits, tgt, reduction='sum')

    def forward(self, input_ids, labels):
        base = self.peft.base_model.model
        h = base.model(input_ids=input_ids, use_cache=False, return_dict=True).last_hidden_state
        sel = (labels[0, 1:] != -100).nonzero(as_tuple=True)[0]
        hs = h[0, sel]
        tgt = labels[0, sel + 1]
        total = h.new_zeros((), dtype=torch.float32)
        for c in range(0, hs.shape[0], self.logit_chunk):
            total = total + torch.utils.checkpoint.checkpoint(self._chunk_loss, hs[c:c + self.logit_chunk],
                                                              tgt[c:c + self.logit_chunk], use_reentrant=False)
        return total, sel.numel()


def build_model(args, device):
    from peft import LoraConfig, get_peft_model
    from transformers import AutoConfig, Gemma4ForConditionalGeneration
    if args.attn == 'chunked':
        register_attention()
    cfg = AutoConfig.from_pretrained(args.base)
    t0 = time.time()
    model = Gemma4ForConditionalGeneration.from_pretrained(args.base, config=cfg, dtype=torch.bfloat16,
                                                           attn_implementation='chunked_sdpa' if args.attn == 'chunked'
                                                           else 'sdpa')
    for name in ('vision_tower', 'embed_vision', 'audio_tower', 'embed_audio'):
        if getattr(model.model, name, None) is not None:
            setattr(model.model, name, None)
    model.config.use_cache = False
    log(f'loaded base in {time.time() - t0:.0f}s')
    lcfg = LoraConfig(r=args.rank, lora_alpha=args.alpha, lora_dropout=args.dropout, target_modules=TARGET_REGEX,
                      bias='none', init_lora_weights=True)
    model = get_peft_model(model, lcfg)   # adapter weights fp32 (autocast_adapter_dtype=True), base frozen bf16
    if getattr(args, 'resume_dir', None):
        from peft import set_peft_model_state_dict
        from safetensors.torch import load_file
        res = set_peft_model_state_dict(model, load_file(str(Path(args.resume_dir) / 'adapter_model.safetensors')))
        missing = [k for k in getattr(res, 'missing_keys', []) if 'lora_' in k]
        assert not missing, f'resume: {len(missing)} LoRA weights missing, e.g. {missing[:2]}'
        log(f'resumed LoRA weights from {args.resume_dir}')
    n_train = sum(p.numel() for p in model.parameters() if p.requires_grad)
    n_mod = sum(1 for n, _ in model.named_modules() if n.endswith('.lora_A'))
    log(f'LoRA modules={n_mod} trainable params={n_train / 1e6:.1f}M')
    model.base_model.model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
    wrapper = LossModel(model, args.logit_chunk)

    from torch.distributed.fsdp import MixedPrecisionPolicy, fully_shard
    mp = MixedPrecisionPolicy(param_dtype=torch.bfloat16, reduce_dtype=torch.float32)
    for layer in model.base_model.model.model.language_model.layers:
        fully_shard(layer, mp_policy=mp)
    fully_shard(wrapper, mp_policy=mp)
    wrapper.to(device)
    return wrapper, model


# ------------------------------------------------------------------------------------------------ data
def load_rows(path, max_len):
    rows = []
    if not path:
        return rows
    for line in open(path):
        r = json.loads(line)
        if r['n_tokens'] <= max_len and r['n_label_tokens'] > 0:
            rows.append(dict(id=r['id'], input_ids=r['input_ids'], labels=r['labels']))
    return rows


def epoch_steps(rows, world, accum, seed):
    """Global steps: lists of world*accum examples, length-balanced across ranks (snake deal after sorting)."""
    rng = random.Random(seed)
    idx = list(range(len(rows)))
    rng.shuffle(idx)
    per = world * accum
    if len(idx) % per:
        idx += idx[: per - len(idx) % per]   # top up the last step with examples from this epoch
    steps = []
    for s in range(0, len(idx), per):
        grp = sorted(idx[s:s + per], key=lambda i: -len(rows[i]['input_ids']))
        ranks = [[] for _ in range(world)]
        for j, i in enumerate(grp):
            r = j % (2 * world)
            ranks[r if r < world else 2 * world - 1 - r].append(i)
        steps.append(ranks)
    return steps


# ------------------------------------------------------------------------------------------------ utils
def log(msg):
    if not dist.is_initialized() or dist.get_rank() == 0:
        print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def lr_at(step, total, warmup, base_lr, min_ratio=0.1):
    if step < warmup:
        return base_lr * (step + 1) / warmup
    p = (step - warmup) / max(1, total - warmup)
    return base_lr * (min_ratio + (1 - min_ratio) * 0.5 * (1 + math.cos(math.pi * p)))


def save_adapter(peft_model, out_dir: Path, args):
    from safetensors.torch import save_file
    sd = {}
    for name, p in peft_model.named_parameters():
        if 'lora_' not in name:
            continue
        t = p.full_tensor() if hasattr(p, 'full_tensor') else p.data
        if dist.get_rank() == 0:
            sd[name.replace('.default.', '.')] = t.detach().to(torch.bfloat16).cpu().contiguous()
    if dist.get_rank() == 0:
        out_dir.mkdir(parents=True, exist_ok=True)
        save_file(sd, str(out_dir / 'adapter_model.safetensors'), metadata={'format': 'pt'})
        peft_model.peft_config['default'].save_pretrained(str(out_dir))   # writes adapter_config.json
        cfg = json.loads((out_dir / 'adapter_config.json').read_text())
        # list form (vLLM / PEFT friendly); the tensors themselves only cover the language model
        cfg.update(target_modules=TARGET_NAMES, base_model_name_or_path='gemma-4-31b-it-qat-w4a16-ct',
                   inference_mode=True)
        (out_dir / 'adapter_config.json').write_text(json.dumps(cfg, indent=2))
        log(f'saved adapter ({len(sd)} tensors, {(out_dir / "adapter_model.safetensors").stat().st_size / 2**20:.0f} MiB)'
            f' -> {out_dir}')
    dist.barrier()


@torch.no_grad()
def evaluate(wrapper, rows, device, max_examples):
    wrapper.eval()
    rank, world = dist.get_rank(), dist.get_world_size()
    rows = rows[:max_examples] if max_examples else rows
    n = math.ceil(len(rows) / world) * world
    tot = torch.zeros(2, device=device, dtype=torch.float64)
    for i in range(rank, n, world):
        r = rows[i % len(rows)]
        loss, k = wrapper(torch.tensor([r['input_ids']], device=device), torch.tensor([r['labels']], device=device))
        if i < len(rows):
            tot += torch.tensor([loss.item(), k], device=device, dtype=torch.float64)
    dist.all_reduce(tot)
    wrapper.train()
    return (tot[0] / tot[1]).item(), int(tot[1].item())


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', default='base_bf16')
    ap.add_argument('--train', default='train.jsonl')
    ap.add_argument('--eval', default='')
    ap.add_argument('--out', required=True)
    ap.add_argument('--rank', type=int, default=16)
    ap.add_argument('--alpha', type=int, default=32)
    ap.add_argument('--dropout', type=float, default=0.05)
    ap.add_argument('--lr', type=float, default=1e-4)
    ap.add_argument('--epochs', type=float, default=2)
    ap.add_argument('--grad-accum', type=int, default=1, help='micro-batches per GPU per step (global batch = N*this)')
    ap.add_argument('--max-len', type=int, default=24576)
    ap.add_argument('--max-steps', type=int, default=-1, help='stop after this many optimizer steps (smoke runs)')
    ap.add_argument('--warmup-steps', type=int, default=3)
    ap.add_argument('--weight-decay', type=float, default=0.0)
    ap.add_argument('--clip', type=float, default=1.0)
    ap.add_argument('--eval-every', type=int, default=0, help='optimizer steps between holdout evals (0 = per epoch)')
    ap.add_argument('--max-eval', type=int, default=0, help='cap holdout examples per eval (0 = all)')
    ap.add_argument('--eval-at-start', action='store_true', help='holdout loss of the untouched base first')
    ap.add_argument('--eval-only', action='store_true', help='only report holdout loss of the base (+ fresh LoRA)')
    ap.add_argument('--attn', choices=['chunked', 'sdpa'], default='chunked')
    ap.add_argument('--logit-chunk', type=int, default=2048)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--save-every-epoch', action='store_true')
    ap.add_argument('--ckpt-every-min', type=float, default=0, help='save a resumable checkpoint (adapter + next step) '
                    'to <out>/ckpt every N minutes (spot/preemptible VMs)')
    ap.add_argument('--resume', action='store_true', help='continue from <out>/ckpt if it exists (same data, seed, '
                    'plan; optimizer moments restart)')
    args = ap.parse_args()

    dist.init_process_group('nccl')
    rank, world = dist.get_rank(), dist.get_world_size()
    local = int(os.environ.get('LOCAL_RANK', rank))
    torch.cuda.set_device(local)
    device = torch.device('cuda', local)
    torch.manual_seed(args.seed)
    out = Path(args.out)
    if rank == 0:
        out.mkdir(parents=True, exist_ok=True)
        (out / 'train_args.json').write_text(json.dumps(vars(args), indent=1))

    train = load_rows(args.train, args.max_len)
    evalr = load_rows(args.eval, args.max_len)
    log(f'world={world} train={len(train)} eval={len(evalr)} label_tokens='
        f'{sum(sum(x != -100 for x in r["labels"]) for r in train)}')
    start_step = 0
    args.resume_dir = None
    ck = out / 'ckpt'
    if args.resume and (ck / 'resume.json').exists() and (ck / 'adapter_model.safetensors').exists():
        start_step = json.loads((ck / 'resume.json').read_text())['next_step']
        args.resume_dir = str(ck)
    wrapper, peft_model = build_model(args, device)
    params = [p for p in wrapper.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, betas=(0.9, 0.999), weight_decay=args.weight_decay, eps=1e-8)

    n_ep = math.ceil(args.epochs)
    plan = []
    for ep in range(n_ep):
        st = epoch_steps(train, world, args.grad_accum, args.seed + ep)
        if ep == n_ep - 1 and args.epochs != n_ep:
            st = st[: max(1, round(len(st) * (args.epochs - (n_ep - 1))))]
        plan += [(ep, s) for s in st]
    if args.max_steps > 0:
        plan = plan[: args.max_steps]
    total = len(plan)
    log(f'{total} optimizer steps, global batch {world * args.grad_accum} sequences')
    if (args.eval_at_start or args.eval_only) and evalr:
        el, en = evaluate(wrapper, evalr, device, args.max_eval)
        log(f'eval step 0: holdout loss {el:.4f} over {en} tokens')
    if args.eval_only:
        dist.destroy_process_group()
        return

    wrapper.train()
    t_start = time.time()
    hist = []
    if start_step:
        log(f'resume: skipping {start_step} finished steps of {total}')
    last_ckpt = time.time()
    for step, (ep, ranks) in enumerate(plan):
        if step < start_step:
            continue
        t0 = time.time()
        mine = ranks[rank]
        n_local = sum(sum(x != -100 for x in train[i]['labels'][1:]) for i in mine)
        n_glob = torch.tensor(float(n_local), device=device)
        dist.all_reduce(n_glob)
        lr = lr_at(step, total, args.warmup_steps, args.lr)
        for g in opt.param_groups:
            g['lr'] = lr
        loss_acc = torch.zeros((), device=device, dtype=torch.float64)
        toks = 0
        for mi, i in enumerate(mine):
            r = train[i]
            ids = torch.tensor([r['input_ids']], device=device)
            lab = torch.tensor([r['labels']], device=device)
            toks += ids.shape[1]
            # FSDP2 averages gradients over ranks: scale so the step gradient = sum(token CE) / global label tokens
            wrapper.set_requires_gradient_sync(mi == len(mine) - 1)
            loss_sum, _ = wrapper(ids, lab)
            (loss_sum * world / n_glob).backward()
            loss_acc += loss_sum.detach().double()
        gn = torch.nn.utils.clip_grad_norm_(params, args.clip)
        gn = gn.full_tensor() if hasattr(gn, 'full_tensor') else gn
        opt.step()
        opt.zero_grad(set_to_none=True)
        dist.all_reduce(loss_acc)
        tt = torch.tensor(float(toks), device=device)
        dist.all_reduce(tt)
        step_loss = (loss_acc / n_glob).item()
        hist.append(dict(step=step + 1, epoch=ep, loss=step_loss, lr=lr, grad_norm=gn.item(),
                         tokens=int(tt.item()), label_tokens=int(n_glob.item()), sec=time.time() - t0))
        log(f'step {step + 1}/{total} ep {ep} loss {step_loss:.4f} lr {lr:.2e} gnorm {gn.item():.3f} '
            f'tok {int(tt.item())} ({tt.item() / (time.time() - t0):.0f} tok/s) {time.time() - t0:.1f}s '
            f'mem {torch.cuda.max_memory_allocated(device) / 2**30:.1f}GiB')
        end_of_epoch = step + 1 == total or plan[step + 1][0] != ep
        if evalr and ((args.eval_every and (step + 1) % args.eval_every == 0) or (not args.eval_every and end_of_epoch)):
            el, en = evaluate(wrapper, evalr, device, args.max_eval)
            hist[-1]['eval_loss'] = el
            log(f'eval step {step + 1}: holdout loss {el:.4f} over {en} tokens')
        if args.save_every_epoch and end_of_epoch and step + 1 != total:
            save_adapter(peft_model, out / f'epoch{ep + 1}', args)
        # rank 0 decides (timer, or a SAVE_NOW file the spot loop touches before the budget ends) and broadcasts it,
        # so all ranks enter the collective save together
        save_now = out / 'SAVE_NOW'
        want = torch.tensor(float(rank == 0 and (time.time() - last_ckpt >= 60 * args.ckpt_every_min
                                                 or save_now.exists())), device=device)
        dist.broadcast(want, 0)
        if args.ckpt_every_min and step + 1 != total and want.item():
            tmp = out / 'ckpt_tmp'
            save_adapter(peft_model, tmp, args)
            if rank == 0:
                (tmp / 'resume.json').write_text(json.dumps({'next_step': step + 1, 'total': total, 'epoch': ep,
                                                             'time': time.strftime('%Y-%m-%d %H:%M:%S')}))
                if ck.exists():
                    import shutil
                    shutil.rmtree(ck)
                tmp.rename(ck)
                save_now.unlink(missing_ok=True)
            dist.barrier()
            last_ckpt = time.time()
            log(f'checkpoint at step {step + 1}/{total} -> {ck}')
    save_adapter(peft_model, out / 'adapter', args)
    if rank == 0:
        (out / 'history.json').write_text(json.dumps(hist, indent=1))
    log(f'done in {(time.time() - t_start) / 60:.1f} min')
    dist.destroy_process_group()


if __name__ == '__main__':
    main()
