"""laya-jp: jev-bench RLCD fine-tune of convaiinnovations/laya-multilingual on MPS/CPU.

Reward contract: teacher (jev-latest) option probabilities per recorded decision
from `scripts/bench.ts --record` are the gold distributions; each shift's outcome
(served/quota completion) is the game reward. Loss per batch:

  - soft cross-entropy against the teacher gold (all decisions)
  - RLCD policy-gradient term over noisy logit projections, rewarded by proper
    scoring rules against gold (GRPO-style, sigma annealed 0.4 -> 0.1)
  - game REINFORCE term: advantage of the shift completion over the batch mean,
    applied to log p of the action actually taken in the rollout

Usage:
    python train/laya_jp.py --record /tmp/jev-teacher.jsonl --output-dir ./train/laya-jp-out
"""
import argparse
import gc
import json
import math
import random
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from safetensors.torch import load_file, save_file
from transformers import AutoTokenizer

from laya.agent import _fix_tokenizer_config
from laya.common import QTYPES, build_model, build_sequence, proper_reward, render_options

MODEL_ID = "convaiinnovations/laya-multilingual"
TEMP_MIN, TEMP_MAX = 0.1, 10.0


def choose_device(requested):
    if requested == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("cuda requested but torch.cuda.is_available() is False")
    if requested == "mps" and not torch.backends.mps.is_available():
        print("Warning: MPS is unavailable; using CPU instead.")
        return torch.device("cpu")
    return torch.device(requested)


def prepare_model(model_dir):
    model_dir = Path(model_dir)
    if not (model_dir / "model.safetensors").exists():
        print(f"Downloading {MODEL_ID} to {model_dir} ...")
        snapshot_download(MODEL_ID, local_dir=str(model_dir))
    # A partial HF fetch can leave an empty tokenizer_config.json; repair once.
    cfg_path = model_dir / "tokenizer" / "tokenizer_config.json"
    for attempt in range(2):
        try:
            json.load(open(cfg_path))
            break
        except (OSError, json.JSONDecodeError):
            print(f"tokenizer_config.json unreadable (attempt {attempt + 1}); re-downloading")
            import shutil
            shutil.rmtree(model_dir, ignore_errors=True)
            snapshot_download(MODEL_ID, local_dir=str(model_dir))
    _fix_tokenizer_config(str(model_dir))
    return str(model_dir)


def build_training_item(tokenizer, cfg, state, question, gold_question, action_idx=None, reward=None):
    if question.get("type") != "choice":
        return None
    criteria = question.get("criteria") or {}
    keys = list(criteria.keys())
    target = [gold_question.get(k, 0.0) for k in keys] if gold_question else None
    if target is None:
        target = [1.0 / len(keys)] * len(keys)
    total = sum(target)
    if total > 0:
        target = [float(x) / total for x in target]
    else:
        target = [1.0 / len(target)] * len(target)
    label = target.index(max(target))
    n_options = len(render_options({"t": "choice", "crit": criteria}))
    sequence, markers = build_sequence(
        tokenizer,
        state,
        {"t": "choice", "ins": question.get("instructions", ""), "crit": criteria},
        cfg["max_len"],
        cfg["head_max_len"],
    )
    if len(markers) != n_options:
        return None
    return {
        "ids": sequence,
        "markers": markers,
        "qtype": QTYPES["choice"],
        "target": target,
        "label": label,
        "has_gold": gold_question is not None,
        "action_idx": action_idx,
        "reward": reward,
    }


def read_records(record_path):
    decisions, shifts = [], {}
    with open(record_path) as f:
        for line in f:
            row = json.loads(line)
            if row["kind"] == "decision":
                decisions.append(row)
            elif row["kind"] == "shift":
                shifts[row["level"]] = row
    completion = {lv: s["served"] / max(1, s["quota"]) for lv, s in shifts.items()}
    return decisions, completion


def prepare_items(tokenizer, cfg, record_path, items_path, force=False):
    items_path = Path(items_path)
    if items_path.exists() and not force:
        print(f"Using cached training items: {items_path}")
        return
    decisions, completion = read_records(record_path)
    items = []
    skipped = 0
    for d in decisions:
        question = d["questions"]["next_action"]
        action_idx = None
        if d["phase"] == "playing" and d["choice"]:
            keys = list(question.get("criteria", {}).keys())
            if d["choice"] in keys:
                action_idx = keys.index(d["choice"])
        reward = completion.get(d["level"]) if d["phase"] == "playing" else None
        item = build_training_item(
            tokenizer,
            cfg,
            d["state"],
            question,
            d["gold"],
            action_idx=action_idx,
            reward=reward,
        )
        if item is None:
            skipped += 1
        else:
            items.append(item)
    items_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(items, items_path)
    print(f"Saved {len(items)} training items from {record_path}; skipped={skipped}")


def collate(items, pad_id):
    batch_size = len(items)
    seq_len = max(len(item["ids"]) for item in items)
    kmax = max(len(item["markers"]) for item in items)
    input_ids = torch.full((batch_size, seq_len), pad_id, dtype=torch.long)
    attention = torch.zeros((batch_size, seq_len), dtype=torch.long)
    marker_pos = torch.zeros((batch_size, kmax), dtype=torch.long)
    marker_mask = torch.zeros((batch_size, kmax), dtype=torch.bool)
    target = torch.zeros((batch_size, kmax), dtype=torch.float32)
    action_idx = torch.full((batch_size,), -1, dtype=torch.long)
    reward = torch.zeros((batch_size,), dtype=torch.float32)
    has_gold = torch.zeros((batch_size,), dtype=torch.bool)

    for i, item in enumerate(items):
        length = len(item["ids"])
        input_ids[i, :length] = torch.tensor(item["ids"], dtype=torch.long)
        attention[i, :length] = 1
        k = len(item["markers"])
        marker_pos[i, :k] = torch.tensor(item["markers"], dtype=torch.long)
        marker_mask[i, :k] = True
        target[i, :len(item["target"])] = torch.tensor(item["target"], dtype=torch.float32)
        if item["action_idx"] is not None and item["reward"] is not None:
            action_idx[i] = item["action_idx"]
            reward[i] = item["reward"]
        has_gold[i] = item["has_gold"]

    return (
        input_ids, attention, marker_pos, marker_mask, target,
        torch.tensor([item["qtype"] for item in items], dtype=torch.long),
        action_idx, reward, has_gold,
    )


def fit_temperature(samples):
    if len(samples) < 10:
        return 1.0
    logits, targets = zip(*samples)
    # Option counts vary per decision; pad to the group max before stacking.
    longest = max(l.shape[0] for l in logits)
    pad_right = lambda t, value: torch.nn.functional.pad(t, (0, longest - t.shape[0]), value=value)
    logits = torch.stack([pad_right(l, -1e4) for l in logits])
    targets = torch.stack([pad_right(t, 0.0) for t in targets])
    log_temperature = torch.zeros(1, requires_grad=True)
    optimizer = torch.optim.LBFGS([log_temperature], lr=0.1, max_iter=100)
    best_loss = float("inf")
    best_temp = 1.0
    for _ in range(50):
        def closure():
            optimizer.zero_grad()
            logits_scaled = logits / log_temperature.exp()
            loss = -(
                targets * torch.log_softmax(logits_scaled, -1)
            ).sum(-1).mean()
            loss.backward()
            return loss
        optimizer.step(closure)
        loss = closure()
        if loss.item() < best_loss:
            best_loss = loss.item()
            best_temp = float(torch.clamp(log_temperature.exp(), TEMP_MIN, TEMP_MAX).item())
    return best_temp if best_temp != 1.0 else 1.2 if len(samples) < 400 else 1.0


def save_checkpoint(model, tokenizer, cfg, output_dir, epoch, final=False):
    path = Path(output_dir) if final else Path(output_dir) / "checkpoint_latest"
    path.mkdir(parents=True, exist_ok=True)
    weights = {
        name: value.detach().half().cpu().contiguous()
        for name, value in model.state_dict().items()
    }
    save_file(weights, str(path / "model.safetensors"))
    model.encoder.config.save_pretrained(path / "encoder")
    tokenizer.save_pretrained(path / "tokenizer")
    with open(path / "checkpoint_meta.json", "w") as f:
        json.dump({"epoch": epoch, "final": final}, f, indent=2)
    with open(path / "rl_agent_config.json", "w") as f:
        json.dump(cfg, f, indent=2)


def train(args, model_dir, items_path, device):
    with open(Path(model_dir) / "rl_agent_config.json") as f:
        cfg = json.load(f)
    cfg.update({"max_tokens_per_batch": 2048, "max_len": 1024, "head_max_len": 256})
    if not args.no_checkpointing:
        cfg["gradient_checkpointing"] = True

    tokenizer = AutoTokenizer.from_pretrained(Path(model_dir) / "tokenizer")
    model = build_model(cfg, encoder_dir=Path(model_dir) / "encoder")
    model.load_state_dict(load_file(str(Path(model_dir) / "model.safetensors")), strict=True)
    model.float()
    if not args.no_checkpointing:
        model.encoder.gradient_checkpointing_enable(
            gradient_checkpointing_kwargs={"use_reentrant": False}
        )
        model.head_checkpointing = True
    model.to(device).train()

    all_items = torch.load(items_path, map_location="cpu", weights_only=False)
    order = list(range(len(all_items)))
    random.Random(20261002).shuffle(order)
    n_calib = min(args.calib_max, len(all_items) // 10)
    calib_items = [all_items[i] for i in sorted(order[:n_calib])]
    train_items = [all_items[i] for i in sorted(order[n_calib:])]

    encoder_params = [p for n, p in model.named_parameters() if "encoder." in n]
    head_params = [p for n, p in model.named_parameters() if "encoder." not in n]
    optimizer = torch.optim.AdamW(
        [{"params": encoder_params, "lr": 2.5e-5}, {"params": head_params, "lr": 1e-4}],
        weight_decay=0.01,
    )
    updates = max(1, math.ceil(len(train_items) / args.micro_batch / args.grad_accum) * args.epochs)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=updates, eta_min=1e-6
    )

    print(f"Device: {device}")
    print(f"Training items: {len(train_items)}; calibration items: {len(calib_items)}")
    print(f"micro_batch={args.micro_batch}; grad_accum={args.grad_accum}; epochs={args.epochs}")

    for epoch in range(args.epochs):
        random.Random(42 + epoch).shuffle(train_items)
        optimizer.zero_grad(set_to_none=True)
        total_loss = 0.0
        n_batches = 0
        sigma = 0.4 + (0.1 - 0.4) * epoch / max(1, args.epochs - 1)

        for start in range(0, len(train_items), args.micro_batch):
            chunk = train_items[start:start + args.micro_batch]
            ids, attention, positions, mask, target, qtype, action_idx, reward, has_gold = collate(
                chunk, tokenizer.pad_token_id
            )
            ids, attention = ids.to(device), attention.to(device)
            positions = positions.to(device)
            mask = mask.to(device)
            target = target.to(device)
            qtype = qtype.to(device)
            action_idx = action_idx.to(device)
            reward = reward.to(device)
            has_gold = has_gold.to(device)

            logits, activation = model(ids, attention, positions, mask, qtype)
            logits = logits.float()
            k = mask.sum(-1, keepdim=True).float()
            logp_all = torch.log_softmax(logits.masked_fill(~mask, -1e4), -1)
            if n_batches < 2:
                with torch.no_grad():
                    print(
                        "dbg",
                        "logits", torch.isfinite(logits).count_nonzero(), logits.shape.numel(),
                        "target", torch.isfinite(target).count_nonzero(), target.shape.numel(),
                        "act", activation.detach().sum().item() if activation is not None else None,
                        flush=True,
                    )

            # 1) RLCD gold term (per-item softmax over sampled noisy projections)
            has_gold_b = has_gold.unsqueeze(0)
            eps = torch.randn((args.samples,) + logits.shape, device=device) * sigma * mask
            eps = (eps - eps.sum(-1, keepdim=True) / k) * mask
            noisy_logits = logits.detach().unsqueeze(0) + eps
            probabilities = torch.softmax(noisy_logits.masked_fill(~mask, -1e4), -1)
            with torch.no_grad():
                reward_gold = proper_reward(
                    probabilities,
                    target.unsqueeze(0),
                    qtype,
                    mask,
                    w_sph=0.75,
                    w_rps=1.0,
                )
                reward_gold = reward_gold * has_gold_b  # drop no-gold items
                advantage = reward_gold - reward_gold.mean(0, keepdim=True)
                advantage = advantage / (advantage.std() + 1e-6)
            logp_noise = -(((noisy_logits - logits.unsqueeze(0)) ** 2) * mask.unsqueeze(0)).sum(-1) / (
                2 * sigma**2
            )
            loss_rl = -(advantage * logp_noise * has_gold_b).mean()

            log_probs = torch.log_softmax(logits.masked_fill(~mask, -1e4), -1)
            loss_ce = -(
                target * log_probs
            ).sum(-1) * has_gold
            loss_ce = loss_ce.sum() / max(1, has_gold.sum().item())

            # 2) game REINFORCE term: shift completion advantage on the taken action
            game = action_idx >= 0
            if game.any():
                r = reward * game.float()
                adv_g = (r - r[game].mean()) / (r[game].std() + 1e-6)
                adv_g = adv_g * game.float()
                taken = torch.log_softmax(logits.masked_fill(~mask, -1e4), -1).gather(
                    1, action_idx.clamp(min=0).unsqueeze(1)
                ).squeeze(1)
                loss_game = -(adv_g * taken).sum() / game.sum().float()
            else:
                loss_game = torch.zeros((), device=device)

            loss = loss_rl + loss_ce + args.game_weight * loss_game
            if n_batches < 2:
                print(
                    "dbg loss", loss_rl.item(), loss_ce.item(), loss_game.item(),
                    "sigma", sigma, flush=True,
                )
            loss = loss / args.grad_accum
            loss.backward()

            n_batches += 1
            if n_batches % args.grad_accum == 0 or start + args.micro_batch >= len(train_items):
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)

            total_loss += loss.item() * args.grad_accum
            if n_batches % 50 == 0:
                print(
                    f"epoch {epoch + 1}/{args.epochs}, step {n_batches}, loss={loss.item() * args.grad_accum:.4f}"
                )

        avg_loss = total_loss / max(1, n_batches)
        print(f"Epoch {epoch + 1}/{args.epochs} complete; avg_loss={avg_loss:.4f}")
        save_checkpoint(model, tokenizer, cfg, args.output_dir, epoch + 1)

    print("Running temperature calibration ...")
    model.eval()
    samples = [[] for _ in range(len(QTYPES))]
    with torch.no_grad():
        for start in range(0, len(calib_items), args.micro_batch):
            chunk = calib_items[start:start + args.micro_batch]
            ids, attention, positions, mask, target, qtype, *_ = collate(chunk, tokenizer.pad_token_id)
            logits, _ = model(
                ids.to(device), attention.to(device), positions.to(device), mask.to(device),
                qtype.to(device),
            )
            for i, item in enumerate(chunk):
                samples[item["qtype"]].append(
                    (logits[i, : len(item["markers"])].cpu(), torch.tensor(item["target"]))
                )

    temperatures = [fit_temperature(group) if group else 1.2 for group in samples]
    save_checkpoint(model, tokenizer, cfg, args.output_dir, args.epochs, final=True)
    cfg.update({"fine_tuned": True, "model_name": "laya-jp", "temperature": temperatures})
    cfg.pop("temperature_by_options", None)
    with open(Path(args.output_dir) / "rl_agent_config.json", "w") as f:
        json.dump(cfg, f, indent=2)
    with open(Path(args.output_dir) / "checkpoint_latest" / "rl_agent_config.json", "w") as f:
        json.dump(cfg, f, indent=2)
    print(f"Model saved to {args.output_dir}")
    print(f"Temperatures: {temperatures}")


def main():
    parser = argparse.ArgumentParser(description="laya-jp: jev-bench RLCD on MPS/CPU")
    parser.add_argument("--model-dir", default="./train/laya_multilingual_base")
    parser.add_argument("--output-dir", default="./train/laya-jp-out")
    parser.add_argument("--items", default="./train/items.pt")
    parser.add_argument("--record", required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--micro-batch", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=16)
    parser.add_argument("--samples", type=int, default=4)
    parser.add_argument("--game-weight", type=float, default=1.0)
    parser.add_argument("--calib-max", type=int, default=200)
    parser.add_argument("--device", choices=["auto", "cuda", "mps", "cpu"], default="auto")
    parser.add_argument("--force-preprocess", action="store_true")
    parser.add_argument("--no-checkpointing", action="store_true")
    args = parser.parse_args()

    torch.set_float32_matmul_precision("high")
    device = choose_device(args.device)
    model_dir = prepare_model(args.model_dir)
    with open(Path(model_dir) / "rl_agent_config.json") as f:
        cfg = json.load(f)
    cfg.update({"max_len": cfg.get("max_len", 1024), "head_max_len": cfg.get("head_max_len", 256)})
    tokenizer = AutoTokenizer.from_pretrained(Path(model_dir) / "tokenizer")
    prepare_items(tokenizer, cfg, args.record, args.items, force=args.force_preprocess)
    train(args, model_dir, args.items, device)
    gc.collect()


if __name__ == "__main__":
    main()