"""Run identical direct decoding on frozen landing-page repair prompts."""

import argparse
import json
import time
from unsloth import FastModel
import torch
from common import ROOT, OUT, BASE, REV, read_rows, sha256, turns, SYSTEM_PATH

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("arm", choices=["base", "adapted"])
parser.add_argument("test_sha256")
parser.add_argument("system_sha256")
parser.add_argument("--split", choices=["primary", "external"], default="primary")
args = parser.parse_args()
path = ROOT / "data" / ("test.jsonl" if args.split == "primary" else "external.jsonl")
if sha256(path) != args.test_sha256 or sha256(SYSTEM_PATH) != args.system_sha256:
    raise SystemExit("Frozen evaluation input or system prompt differs.")
OUT.mkdir(exist_ok=True)
conf = (
    {"model_name": BASE, "revision": REV}
    if args.arm == "base"
    else {"model_name": str(ROOT / "adapter")}
)
t0 = time.monotonic()
model, tok = FastModel.from_pretrained(
    **conf, max_seq_length=4096, load_in_4bit=True, full_finetuning=False
)
FastModel.for_inference(model)
tokenizer = getattr(tok, "tokenizer", tok)
tokenizer.padding_side = "left"
end = tokenizer.convert_tokens_to_ids("<|end_message|>")
torch.cuda.synchronize()
load_seconds = time.monotonic() - t0
cases = read_rows(path)
assert cases and len({r["id"] for r in cases}) == len(cases)
label = (
    args.arm
    if args.split == "primary"
    else ("base-external" if args.arm == "base" else "tuned-external")
)
destination = OUT / f"{label}.jsonl"
timing_file = OUT / f"{label}-timing.json"
if destination.exists() or timing_file.exists():
    raise SystemExit("An earlier attempt already exists for this checkpoint.")
t = time.monotonic()
count = 0
with destination.open("x") as file, torch.inference_mode():
    for start in range(0, len(cases), 8):
        batch = cases[start : start + 8]
        prompts = [
            tok.apply_chat_template(
                turns(r),
                tokenize=False,
                add_generation_prompt=True,
                reasoning_effort="none",
            )
            + "<|content_text|>"
            for r in batch
        ]
        inputs = tokenizer(
            prompts, padding=True, add_special_tokens=False, return_tensors="pt"
        ).to("cuda")
        assert inputs.input_ids.shape[1] + 500 <= 4096
        generated = model.generate(
            **inputs,
            do_sample=False,
            max_new_tokens=500,
            eos_token_id=end,
            pad_token_id=tokenizer.pad_token_id,
        )
        for case, sequence, attention in zip(batch, generated, inputs.attention_mask):
            output = sequence[inputs.input_ids.shape[1] :].tolist()
            complete = end in output
            if complete:
                output = output[: output.index(end)]
            raw = tokenizer.decode(
                output,
                skip_special_tokens=False,
                clean_up_tokenization_spaces=False,
            )
            record = {
                "id": case["id"],
                "raw": raw,
                "hit_cap": not complete,
                "input_tokens": int(attention.sum()),
                "output_tokens": len(output),
            }
            file.write(json.dumps(record) + "\n")
            count += len(output)
        file.flush()
        print(args.arm, start + len(batch), "/", len(cases), flush=True)
torch.cuda.synchronize()
duration = time.monotonic() - t
receipt = {
    "arm": args.arm,
    "split": args.split,
    "checkpoint": conf,
    "system_sha256": args.system_sha256,
    "input_sha256": sha256(path),
    "cases": [r["id"] for r in cases],
    "batch_size": 8,
    "max_new_tokens": 500,
    "reasoning_effort": "none",
    "visible_channel_prefill": True,
    "wall_seconds": duration + load_seconds,
    "generation_seconds": duration,
    "model_load_seconds": load_seconds,
    "output_tokens": count,
}
timing_file.write_text(json.dumps(receipt, indent=2) + "\n")
print("RESPONSIVE_REPAIR_RESULT", args.arm, flush=True)
