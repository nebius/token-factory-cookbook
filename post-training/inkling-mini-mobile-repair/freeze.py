"""Keep only browser-verified Kimi pairs and record the exact frozen inputs."""

import json
from pages import DATA, ROOT, read_rows, write_rows, sha


def freeze():
    checks = ROOT / "work/checks/teacher"
    manifest = {}
    selection = {}
    for split, source in [("train", "candidates"), ("validation", "validation")]:
        out = []
        for row in read_rows(DATA / (source + "-pages.jsonl")):
            decision = json.loads((checks / (row["id"] + ".json")).read_text())
            source_art = json.loads(
                (ROOT / "work/teacher" / (row["id"] + ".json")).read_text()
            )
            if decision["pass"] and source_art["reason"] == "stop":
                out.append(
                    dict(
                        row,
                        response=source_art["response"],
                        teacher=source_art["model"],
                    )
                )
        write_rows(DATA / (split + ".jsonl"), out)
        selection[split] = out
    frozen = read_rows(DATA / "test-pages.jsonl")
    for split, out in selection.items():
        assert len({r["prompt"] for r in out}) == len(out)
        assert not {r["family"] for r in out} & {r["family"] for r in frozen}
        assert not {r["prompt"] for r in out} & {r["prompt"] for r in frozen}
        assert not {tuple(sorted(r["flags"])) for r in out} & {
            tuple(sorted(r["flags"])) for r in frozen
        }
    manifest = {
        "counts": {
            "train": len(selection["train"]),
            "validation": len(selection["validation"]),
            "test": len(frozen),
        },
        "teacher": "moonshotai/Kimi-K3.1-Pro",
        "teacher_candidates": len(list((ROOT / "work/teacher").glob("*.json"))),
        "splits": "Nine training brands (one or two bugs), two validation brands (one or two), six unseen test brands across four unseen three-bug combinations. All are from one shared component generator.",
        "browsers": "DOM geometry, CSS, containment and visibility in headless Brave at 320, 375, 430, 1024 and 1280 pixels. All components must pass; both desktop snapshots must match.",
        "sha256": {
            n: sha(DATA / n)
            for n in [
                "train.jsonl",
                "validation.jsonl",
                "test-pages.jsonl",
                "test.jsonl",
                "system.txt",
            ]
        },
    }
    (DATA / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    freeze()
