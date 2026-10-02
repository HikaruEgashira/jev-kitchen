#!/usr/bin/env bash
# laya-jp RLCD イテレーションループ: ロールアウト → データ蓄積 → RunPod 訓練 → 評価。
# cleared >= TARGET で停止。各ステージの結果は train/data/progress.tsv に追記。
#
# 前提: RUNPOD_API_KEY 等の secrets 設定済み（gh workflow run 経由）。
# ローカル Mac は推論（サーブ・ロールアウト）のみ、訓練は全て RunPod。
set -euo pipefail
export PATH="$PATH:/usr/bin:/bin"
cd "$(dirname "$0")/.."
REPO=HikaruEgashira/jev-kitchen
DATA=train/data/teacher.jsonl          # stage-0: jev 教師ゴールド（全クリア）
ROLLOUTS=train/data/rollouts.jsonl     # ステージ毎に追記（self ロールアウト、失敗混在）
ALL=train/data/all.jsonl               # 訓練入力（両者結合・コミット）
OUT=train/laya-jp-out
TARGET="${1:-15}"
EPOCHS="${2:-3}"
[ -f "$ROLLOUTS" ] || : > "$ROLLOUTS"
mkdir -p "$(dirname "$DATA")"

stage=0
# ローカル Worker 確認（ロールアウトは /api/bench/decide 経由）
if ! curl -s --max-time 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
  pnpm dev:api > /tmp/dev-api.log 2>&1 &
  for i in $(seq 1 60); do curl -s --max-time 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1 && break; sleep 1; done
fi

while :; do
  stage=$((stage + 1))
  echo "=== stage $stage: rollout + score（現行モデル） $(date +%H:%M:%S) ==="

  # ローカル推論サーブ（既存のポート9300があればそれを利用）
  if ! curl -s --max-time 2 http://127.0.0.1:9300/ping >/dev/null 2>&1; then
    .venv-train/bin/python train/serve_jp.py --model-dir "$OUT" --port 9300 > /tmp/serve-jp.log 2>&1 &
    sleep 10
  fi

  # ロールアウト（score 測定とデータ収集を兼ねる）
  BENCH_ORIGIN=http://127.0.0.1:8787 node scripts/bench.ts --model laya_jp \
    --accelerated --frequency 3 --until 20 --record "$ROLLOUTS" \
    --output /tmp/stage-rollout.json > /tmp/stage-rollout.log 2>&1 || true
  CLEARED=$(python3 -c "import json;print(json.load(open('/tmp/stage-rollout.json'))['clearedLevels'])" 2>/dev/null || echo 0)
  SCORE=$(python3 -c "import json;print(json.load(open('/tmp/stage-rollout.json'))['score'])" 2>/dev/null || echo 0)
  echo -e "$stage\t$CLEARED\t$SCORE\t$(date -u +%FT%TZ)" >> train/data/progress.tsv
  echo "stage $stage: cleared=$CLEARED score=$SCORE"
  if [ "$CLEARED" -ge "$TARGET" ]; then
    echo "TARGET REACHED: cleared=$CLEARED >= $TARGET"; exit 0
  fi

  # データ結合・コミット・訓練ディスパッチ
  cat "$DATA" "$ROLLOUTS" > "$ALL"
  git add "$ROLLOUTS" "$ALL" train/data/progress.tsv
  git commit -q -m "train: stage $stage rollouts (cleared=$CLEARED)" --allow-empty
  git push -q origin main 2>&1 | grep -c Bypassed >/dev/null || true

  echo "=== stage $stage: RunPod training $(date +%H:%M:%S) ==="
  RID=$(gh workflow run train-laya-jp.yml -R "$REPO" -f record="$ALL" -f epochs="$EPOCHS" -f game_weight=1.0 -f max_price=0.5 2>/dev/null \
    && sleep 12 && gh run list -R "$REPO" --workflow train-laya-jp.yml -L 1 --json databaseId --jq '.[0].databaseId')
  [ -n "$RID" ] || { echo "dispatch failed"; exit 1; }
  while :; do
    sleep 60
    ST=$(gh run view "$RID" -R "$REPO" --json status --jq '.status // ""' 2>/dev/null || true)
    CN=$(gh run view "$RID" -R "$REPO" --json conclusion --jq '.conclusion // ""' 2>/dev/null || true)
    if [ "$ST" = completed ]; then break; fi
    if [ "$ST" != in_progress ] && [ "$ST" != queued ]; then echo "(run $ST; waiting)"; fi
  done
  echo "training run: $ST/$CN"
  case "$ST/$CN" in completed/success);; *) echo "training failed ($ST/$CN); retry next cycle"; sleep 60;; esac

  # チェックポイント取得（直前を掃除して領域確保）
  rm -rf "$OUT" /tmp/laya-jp-art
  mkdir -p /tmp/laya-jp-art
  gh run download "$RID" -R "$REPO" -n "laya-jp-model-$RID-1" -D /tmp/laya-jp-art/model >/dev/null 2>&1 || true
  if [ -d /tmp/laya-jp-art/model/checkpoint_latest ]; then
    mv /tmp/laya-jp-art/model/checkpoint_latest "$OUT"
    echo "checkpoint updated (stage $stage)"
  else
    echo "WARN: checkpoint artifact missing; keeping previous weights"
  fi
  rm -rf /tmp/laya-jp-art
done