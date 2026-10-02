"""Serve a trained laya-jp checkpoint as a TypeSafe /v1/systemone HTTP endpoint.

Inference only (no training): loads the decision head from a trained
checkpoint dir (model.safetensors + encoder + tokenizer + rl_agent_config)
and exposes the same JSON contract as jev.plenoai.com/v1/systemone so the
bench can evaluate the model with BENCH_ENDPOINTS.

Usage:
    python train/serve_jp.py --model-dir train/laya-jp-out --port 9300
"""
import argparse
import asyncio
import json
from pathlib import Path

import torch
from safetensors.torch import load_file
from transformers import AutoTokenizer
from fastapi import FastAPI, Request, HTTPException

from laya.common import build_model, build_sequence, render_options

app = FastAPI()
MODEL = None  # set in main


@app.post("/v1/systemone")
async def serve(request: Request):
    body = await request.json()
    state = body.get("state")
    questions = body.get("questions")
    if state is None or not isinstance(questions, dict):
        raise HTTPException(status_code=422, detail="state and questions required")
    answers = {}
    for qid, question in questions.items():
        if question.get("type") != "choice":
            raise HTTPException(status_code=422, detail="only choice questions supported")
        keys = list(question["criteria"].keys())
        seq, markers = build_sequence(
            MODEL["tokenizer"],
            state,
            {
                "t": "choice",
                "ins": question.get("instructions", ""),
                "crit": question["criteria"],
            },
            MODEL["cfg"]["max_len"],
            MODEL["cfg"]["head_max_len"],
        )
        ids = torch.tensor([seq], dtype=torch.long, device=MODEL["device"])
        attn = torch.ones_like(ids)
        pos = torch.tensor([markers], dtype=torch.long, device=MODEL["device"])
        mask = torch.ones((1, len(markers)), dtype=torch.bool, device=MODEL["device"])
        qtype = torch.tensor([0], dtype=torch.long, device=MODEL["device"])
        with torch.no_grad():
            logits, _ = MODEL["model"](ids, attn, pos, mask, qtype)
        logits = logits.float()[0, : len(markers)] / MODEL["temperature"]
        probs = torch.softmax(logits, -1)
        probs = (probs / probs.sum()).tolist()
        idx = probs.index(max(probs))
        answers[qid] = {
            "type": "choice",
            "choice": keys[idx],
            "probabilities": dict(zip(keys, probs)),
            "confidence": float(probs[idx]),
        }
    return {"answers": answers, "model": "laya-jp"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", default="train/laya-jp-out")
    parser.add_argument("--port", type=int, default=9300)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--device", choices=["auto", "cuda", "mps", "cpu"], default="auto")
    args = parser.parse_args()

    device = (
        "cuda"
        if (args.device == "auto" and torch.cuda.is_available())
        else "mps"
        if (args.device == "auto" and torch.backends.mps.is_available())
        else args.device
    )
    d = Path(args.model_dir)
    cfg = json.load(open(d / "rl_agent_config.json"))
    model = build_model(cfg, encoder_dir=d / "encoder")
    model.load_state_dict(load_file(str(d / "model.safetensors")), strict=True)
    model.to(device).eval()
    temperature = (cfg.get("temperature") or [1.2, 1.2, 1.2])[0]
    global MODEL
    MODEL = {
        "model": model,
        "tokenizer": AutoTokenizer.from_pretrained(d / "tokenizer"),
        "cfg": cfg,
        "device": torch.device(device),
        "temperature": temperature,
    }
    print(f"laya-jp serving on http://{args.host}:{args.port} (device={device})", flush=True)
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()