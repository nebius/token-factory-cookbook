"""Generate original CSS repairs with Kimi and retain exact priced usage."""

import concurrent.futures, json, os, re, time, urllib.error, urllib.request
from pages import ROOT, DATA, read_rows

WORK = ROOT / "work"
MODEL = "moonshotai/Kimi-K3.1-Pro"


def api_key():
    if os.getenv("NEBIUS_API_KEY"):
        return os.environ["NEBIUS_API_KEY"]
    raise RuntimeError("Missing Nebius API key")


def clean_css(s):
    s = s.strip()
    m = re.fullmatch(r"```(?:css)?\s*(.*?)\s*```", s, re.S | re.I)
    return m[1].strip() if m else s


def generate(row):
    out = WORK / "teacher" / (row["id"] + ".json")
    if out.exists():
        return True
    system = (
        (DATA / "system.txt").read_text()
        + " Write the smallest complete CSS patch that resolves this ticket with no unnecessary styling. End after the final closing brace."
    )
    req = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": row["prompt"]},
        ],
        "max_tokens": 950,
        "temperature": 0.4,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    request = urllib.request.Request(
        "https://api.tokenfactory.nebius.com/v1/chat/completions",
        data=json.dumps(req).encode(),
        headers={
            "Authorization": "Bearer " + api_key(),
            "Content-Type": "application/json",
        },
    )
    for attempt in range(4):
        start = time.time()
        try:
            with urllib.request.urlopen(request, timeout=100) as f:
                ans = json.load(f)
            break
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2 + 2 * attempt)
    choice = ans["choices"][0]
    record = {
        "id": row["id"],
        "model": ans["model"],
        "response": clean_css(choice["message"]["content"] or ""),
        "usage": ans["usage"],
        "reason": choice["finish_reason"],
        "start": start,
        "end": time.time(),
    }
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(record))
    tmp.replace(out)
    return True


if __name__ == "__main__":
    (WORK / "teacher").mkdir(parents=True, exist_ok=True)
    todo = read_rows(DATA / "candidates-pages.jsonl") + read_rows(
        DATA / "validation-pages.jsonl"
    )
    with concurrent.futures.ThreadPoolExecutor(20) as pool:
        running = {pool.submit(generate, r): r["id"] for r in todo}
        errors = []
        for n, f in enumerate(concurrent.futures.as_completed(running), 1):
            try:
                f.result()
            except Exception as e:
                errors.append((running[f], str(e)))
            if n % 30 == 0:
                print(n, "completed; errors", len(errors), flush=True)
        if errors:
            print(errors)
            raise SystemExit(1)
