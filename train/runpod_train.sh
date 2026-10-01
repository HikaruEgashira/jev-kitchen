#!/usr/bin/env bash
# laya-jp RLCD 訓練の RunPod 実行手順（ローカル Mac での訓練は禁止: 貧弱のため）。
#
# 必要: 個人 API key（RunPod → Settings → API Keys → New API key）。現行の
# ~/.runpod/config.toml の key は serverless スコープで pod 作成権限がない。
#   export RUNPOD_API_KEY=rpa_...
#          (or) ダッシュボードで手動 pod 作成 → ID を渡す
#
# 手順（pod 上で実行）:
#   git clone https://github.com/HikaruEgashira/jev-kitchen && cd jev-kitchen
#   python3 -m venv .venv && source .venv/bin/activate
#   pip install torch transformers datasets safetensors huggingface_hub laya
#   python train/laya_jp.py --record train/data/teacher.jsonl \
#       --epochs 3 --game-weight 1.0 --output-dir train/laya-jp-out
#   # 出力 train/laya-jp-out/{model.safetensors, rl_agent_config.json, encoder/, tokenizer/}
#   # をローカル/プロバイダへ転送し、pod を削除する。
#
# チェックポイント転送後は eval_jp.py で corpus 検証、ベンチで score を測る。
echo "runbook: see the header. GPU pod required; this machine trains nothing."