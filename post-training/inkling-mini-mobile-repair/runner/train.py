"""Train a fresh, checksum-pinned QLoRA adapter on synthetic responsive layout repairs."""

import gc
import sys
import importlib.metadata as md
import json
import os
import time

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
from unsloth import FastModel
from unsloth.chat_templates import train_on_responses_only
from datasets import Dataset
from trl import SFTTrainer, SFTConfig
import torch
from common import (
    BASE,
    REV,
    ROOT,
    OUT,
    SYSTEM as SPEC,
    SYSTEM_PATH,
    read_rows,
    turns,
    sha256,
)

OUT.mkdir(exist_ok=True)


def elapsed(t):
    torch.cuda.synchronize()
    return time.monotonic() - t


def save(name, d):
    (OUT / name).write_text(json.dumps(d, indent=2))


start = time.monotonic()
train_path = ROOT / "data/train.jsonl"
if len(sys.argv) != 2 or sha256(train_path) != sys.argv[1]:
    raise SystemExit("Training corpus checksum does not match the frozen input.")
if (ROOT / "adapter/adapter_model.safetensors").exists():
    raise SystemExit("An adapter already exists in this run directory.")
train = read_rows(train_path)
test = read_rows(ROOT / "data/test.jsonl")
assert not {r["prompt"].strip() for r in train} & {r["prompt"].strip() for r in test}
assert len({r["id"] for r in train}) == len(train)
assert len({r["id"] for r in test}) == len(test)
assert all(r["response"].strip() for r in train)
metrics = {
    "model": BASE,
    "revision": REV,
    "gpu": torch.cuda.get_device_name(),
    "train_rows": len(train),
    "test_rows": len(test),
    "sha256": {
        str(path.relative_to(ROOT)): sha256(path)
        for path in [train_path, ROOT / "data/test.jsonl", SYSTEM_PATH]
    },
    "training_context_limit": 4096,
    "lora_rank": 8,
    "lora_alpha": 8,
    "epochs": 2,
    "learning_rate": 1e-4,
    "versions": {
        p: md.version(p) for p in ["unsloth", "torch", "transformers", "trl", "peft"]
    },
}
save("metrics.json", metrics)
model, tok = FastModel.from_pretrained(
    model_name=BASE,
    revision=REV,
    max_seq_length=4096,
    load_in_4bit=True,
    full_finetuning=False,
)
tokenizer = getattr(tok, "tokenizer", tok)
metrics["model_load_seconds"] = elapsed(start)


def rendered(messages, generation):
    return tok.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=generation,
        reasoning_effort="none",
    )


texts = [rendered(turns(r, True), False) for r in train]
lengths = [len(tokenizer.encode(s, add_special_tokens=False)) for s in texts]
if max(lengths) > 4096:
    raise ValueError(
        f"Longest sample is {max(lengths)} tokens and exceeds the full-target training context."
    )
metrics["training_max_sequence_tokens"] = max(lengths)


tokenizer.padding_side = "right"
FastModel.for_training(model)
model = FastModel.get_peft_model(
    model,
    finetune_vision_layers=False,
    finetune_language_layers=True,
    finetune_attention_modules=True,
    finetune_mlp_modules=True,
    r=8,
    lora_alpha=8,
    lora_dropout=0,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)
trainer = SFTTrainer(
    model=model,
    tokenizer=tok,
    train_dataset=Dataset.from_dict({"text": texts}),
    args=SFTConfig(
        dataset_text_field="text",
        max_length=4096,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        warmup_steps=4,
        num_train_epochs=2,
        learning_rate=1e-4,
        logging_steps=5,
        optim="adamw_8bit",
        weight_decay=0.001,
        lr_scheduler_type="linear",
        seed=3407,
        output_dir="trainer-tmp",
        report_to="none",
        save_strategy="no",
        disable_tqdm=True,
        dataset_num_proc=1,
    ),
)
trainer = train_on_responses_only(
    trainer, instruction_part="<|message_user|>", response_part="<|message_model|>"
)
sup = tokenizer.decode(
    [v for v in trainer.train_dataset[0]["labels"] if v != -100],
    clean_up_tokenization_spaces=False,
)
target = tokenizer.decode(
    tokenizer.encode(train[0]["response"], add_special_tokens=False),
    clean_up_tokenization_spaces=False,
).strip()
assert target in sup and SPEC not in sup
assert all(any(v != -100 for v in labels) for labels in trainer.train_dataset["labels"])
save("mask.json", {"supervised_example": sup})
metrics["trainable_parameters"], metrics["all_parameters"] = (
    model.get_nb_trainable_parameters()
)
gc.collect()
torch.cuda.empty_cache()
torch.cuda.reset_peak_memory_stats()
t = time.monotonic()
loss = trainer.train()
metrics["train_seconds"] = elapsed(t)
metrics["peak_allocated_gib"] = torch.cuda.max_memory_allocated() / 2**30
metrics["peak_reserved_gib"] = torch.cuda.max_memory_reserved() / 2**30
metrics["trainer"] = loss.metrics
save("loss.json", trainer.state.log_history)
save("metrics.json", metrics)
model.save_pretrained(ROOT / "adapter")
tok.save_pretrained(ROOT / "adapter")
del trainer
gc.collect()
torch.cuda.empty_cache()

metrics["run_seconds"] = elapsed(start)
save("metrics.json", metrics)
print("RESPONSIVE_REPAIR_TRAINING_COMPLETE", flush=True)
