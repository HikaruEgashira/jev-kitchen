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
NOISE=0
BEST=0
FLAT=0
EPOCHS="${2:-3}"
# ローカル Worker 確認（ロールアウトは /api/bench/decide 経由）
if ! curl -s --max-time 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
  pnpm dev:api > /tmp/dev-api.log 2>&1 &
  for i in $(seq 1 60); do curl -s --max-time 2 http://127.0.0.1:8787/api/health >/dev/null 2>&1 && break; sleep 1; done
fi

while :; do
  stage=$((stage + 1))
  echo "=== stage $stage: rollout + score（現行モデル, noise=${NOISE}, epochs=${EPOCHS}） $(date +%H:%M:%S) ==="

  # ローカル推論サーブ（noise 設定を反映するため毎ステージ再起動）
  pkill -f "serve_jp.py" 2>/dev/null || true
  sleep 1
  .venv-train/bin/python train/serve_jp.py --model-dir "$OUT" --port 9300 --noise "$NOISE" > /tmp/serve-jp.log 2>&1 &
  for i in $(seq 1 30); do curl -s --max-time 2 http://127.0.0.1:9300/v1/none >/dev/null 2>&1 && curl -s --max-time 2 http://127.0.0.1:9300/v1/none >/dev/null 2>&1 && break; sleep 2; done
  sleep 3

  # ロールアウト（score 測定とデータ収集を兼ねる）
  BENCH_ORIGIN=http://127.0.0.1:8787 node scripts/bench.ts --model laya_jp \
    --accelerated --frequency 3 --until 20 --record "$ROLLOUTS" \
    --output /tmp/stage-rollout.json > /tmp/stage-rollout.log 2>&1 || true
  CLEARED=$(python3 -c "import json;print(json.load(open('/tmp/stage-rollout.json'))['clearedLevels'])" 2>/dev/null || echo 0)
  SCORE=$(python3 -c "import json;print(json.load(open('/tmp/stage-rollout.json'))['score'])" 2>/dev/null || echo 0)
  # インフラ要因の 0 クリア（サーブ未起動など）は 1 回再試行する
  if [ "$CLEARED" -eq 0 ] 2>/dev/null; then
    echo "cleared=0; restarting serve and retrying the rollout once"
    pkill -f "serve_jp.py" 2>/dev/null || true
    sleep 120
    (.venv-train/bin/python train/serve_jp.py --model-dir "$OUT" --port 9300 --noise "$NOISE" > /tmp/serve-jp.log 2>&1 &)
    for r in $(seq 1 30); do curl -s --max-time 2 http://127.0.0.1:9300/v1/none >/dev/null 2>&1 && break; sleep 2; done
    BENCH_ORIGIN=http://127.0.0.1:8787 node scripts/bench.ts --model laya_jp \
      --accelerated --frequency 3 --until 20 --record "$ROLLOUTS" \
      --output /tmp/stage-rollout.json > /tmp/stage-rollout.log 2>&1 || true
    CLEARED=$(python3 -c "import json;print(json.load(open('/tmp/stage-rollout.json'))['clearedLevels'])" 2>/dev/null || echo 0)
    SCORE=$(python3 -c "import json;print(json.load(open('/tmp/stage-rollout.json'))['score'])" 2>/dev/null || echo 0)
    if [ "$CLEARED" -eq 0 ] 2>/dev/null; then
      echo "rollout still 0; skipping this training round"
      sleep 300
      continue
    fi
  fi
  echo -e "$stage\t$CLEARED\t$SCORE\t$(date -u +%FT%TZ)\tnoise=$NOISE epochs=$EPOCHS" >> train/data/progress.tsv
  echo "stage $stage: cleared=$CLEARED score=$SCORE (noise=${NOISE} epochs=${EPOCHS})"
  if [ "$CLEARED" -ge "$TARGET" ]; then
    echo "TARGET REACHED: cleared=$CLEARED >= $TARGET"; exit 0
  fi

  # 停滞検知: 3ステージ改善なし → 探査ノイズ投入・epochs 増強・教師データ再取得
  if [ "$CLEARED" -gt "$BEST" ]; then
    BEST="$CLEARED"; FLAT=0
    [ "$NOISE" != 0 ] && { NOISE=0; echo "reset exploration (improved to $BEST)"; }
  else
    FLAT=$((FLAT + 1))
    if [ "$FLAT" -ge 3 ]; then
      EPOCHS=$((EPOCHS + 2))
      [ "$EPOCHS" -gt 4 ] && EPOCHS=4
      if [ "$NOISE" = 0 ]; then NOISE=0.3; else NOISE=$(echo "$NOISE * 1.4" | bc -l 2>/dev/null || echo 0.4); fi
      echo "ESCALATE: flat=$FLAT -> noise=${NOISE} epochs=${EPOCHS}"
      # 深レベルの教師ゴールドを補充（jev を再ロールアウト）
      BENCH_ORIGIN=http://127.0.0.1:8787 node scripts/bench.ts --model jev \
        --accelerated --frequency 3 --until 20 --record "$DATA" \
        --output /tmp/jev-refresh.json > /tmp/jev-refresh.log 2>&1 || true
      FLAT=0
    fi
  fi

  # データ結合・コミット・訓練ディスパッチ
  cat "$DATA" "$ROLLOUTS" > "$ALL"
  git add "$ROLLOUTS" "$ALL" "$DATA" train/data/progress.tsv
  git commit -q -m "train: stage $stage rollouts (cleared=$CLEARED, noise=$NOISE)" --allow-empty
  git push -q origin main 2>&1 | grep -c Bypassed >/dev/null || true

  echo "=== stage $stage: RunPod training $(date +%H:%M:%S) ==="
  RID=$(gh workflow run train-laya-jp.yml -R "$REPO" -f record="$ALL" -f epochs="$EPOCHS" -f game_weight=1.0 -f max_price=0.5 2>/dev/null \
    | rg -o '[0-9]{6,}' | tail -1)
  [ -n "$RID" ] || { echo "dispatch failed"; exit 1; }
  echo "training run: $RID"
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
    echo "$RID" > train/data/last-good-artifact.txt
    echo "checkpoint updated (stage $stage)"
  else
    echo "WARN: checkpoint artifact missing; trying the last good artifact"
    LAST_GOOD=$(cat train/data/last-good-artifact.txt 2>/dev/null || true)
    if [ -n "$LAST_GOOD" ] && [ ! -d "$OUT/model.safetensors" ]; then
      mkdir -p /tmp/laya-jp-art
      gh run download "$LAST_GOOD" -R "$REPO" -n "laya-jp-model-$LAST_GOOD-1" -D /tmp/laya-jp-art/model >/dev/null 2>&1 || true
      if [ -d /tmp/laya-jp-art/model/checkpoint_latest ]; then
        mv /tmp/laya-jp-art/model/checkpoint_latest "$OUT"
        echo "restored checkpoint from artifact $LAST_GOOD"
      fi
      rm -rf /tmp/laya-jp-art
    fi
  fi
  rm -rf /tmp/laya-jp-art
done