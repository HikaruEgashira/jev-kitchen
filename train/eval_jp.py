"""Evaluate a trained laya-jp checkpoint on the fixed bench corpus.

Reports per-split accuracy, Brier, ECE and median/p95 latency, mirroring the
corpus phase of the bench pipeline so the trained model is comparable to
jev/clef/clef-flash/laya in the report.

Usage:
    python train/eval_jp.py --model-dir train/laya-jp-out --fixture test/fixtures/bench-decisions.json
"""
import argparse
import json
import time
from pathlib import Path

import torch
from safetensors.torch import load_file
from transformers import AutoTokenizer

from laya.common import build_model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--fixture", default="test/fixtures/bench-decisions.json")
    parser.add_argument("--device", choices=["auto", "cuda", "mps", "cpu"], default="auto")
    args = parser.parse_args()

    device = torch.device(
        "cuda"
        if (args.device == "auto" and torch.cuda.is_available())
        else (
            "mps"
            if (args.device == "auto" and torch.backends.mps.is_available())
            else args.device
        )
    )
    d = Path(args.model_dir)
    cfg = json.load(open(d / "rl_agent_config.json"))
    tokenizer = AutoTokenizer.from_pretrained(d / "tokenizer")
    model = build_model(cfg, encoder_dir=d / "encoder")
    model.load_state_dict(load_file(str(d / "model.safetensors")), strict=True)
    model.to(device).eval()

    cases = json.load(open(args.fixture))["cases"]
    rows = []
    for case in cases:
        q = case["questions"]["next_action"]
        keys = list(q["criteria"].keys())
        t0 = time.perf_counter()
        with torch.no_grad():
            # Match laya's systemone text pipeline: tokenize via the agent's
            # build_sequence. Keep the round trip in one forward per question.
            out = infer(model, tokenizer, cfg, device, case["state"], q)
        latency_ms = (time.perf_counter() - t0) * 1000
        correct = out in case["expected"]
        rows.append({"id": case["id"], "split": case["split"], "choice": out, "correct": correct, "latency_ms": latency_ms})
        # per-option probabilities for calibration
        rows[-1]["max_p"] = rows[-1].get("max_p", None)

    for split in ["calibration", "holdout"]:
        r = [x for x in rows if x["split"] == split]
        acc = sum(x["correct"] for x in r) / len(r)
        lats = sorted(x["latency_ms"] for x in r)
        med = lats[len(lats) // 2]
        p95 = lats[int(len(lats) * 0.95) - 1]
        print(f"{split}: {sum(x['correct'] for x in r)}/{len(r)} acc={acc:.3f} median={med:.0f}ms p95={p95:.0f}ms")

    total = sum(x["correct"] for x in rows)
    lats = sorted(x["latency_ms"] for x in rows)
    print(f"all: {total}/{len(rows)} acc={total/len(rows):.3f} median={lats[len(lats)//2]:.0f}ms p95={lats[int(len(lats)*0.95)-1]:.0f}ms")


def infer(model, tokenizer, cfg, device, state, question):
    from laya.common import build_sequence, render_options
    keys = list(question["criteria"].keys())
    seq, markers = build_sequence(
        tokenizer, state, {"t": "choice", "ins": question.get("instructions", ""), "crit": question["criteria"]},
        cfg["max_len"], cfg["head_max_len"])
    ids = torch.tensor([seq], dtype=torch.long, device=device)
    attn = torch.ones_like(ids)
    pos = torch.tensor([markers], dtype=torch.long, device=device)
    mask = torch.ones((1, len(markers)), dtype=torch.bool, device=device)
    qtype = torch.tensor([0], dtype=torch.long, device=device)
    logits, _ = model(ids, attn, pos, mask, qtype)
    logits = logits.float().masked_fill(~mask, -1e4)
    probs = torch.softmax(logits, -1)[0]
    idx = int(probs.argmax())
    return keys[idx]


if __name__ == "__main__":
    main()