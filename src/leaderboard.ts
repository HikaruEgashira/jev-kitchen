/**
 * Leaderboard fetching and the X share text.
 *
 * Fetching is best-effort and happens only when the ranking page is opened, so
 * it never touches the game frame loop. The board itself is validated on the
 * server; the client renders whatever it last received.
 */
import { useKitchen } from './game.ts';
import { shareToX } from './share.ts';
import type { BoardEntry, LeaderboardKind } from './types.ts';

export async function refreshLeaderboard(kind?: LeaderboardKind): Promise<void> {
  const target = kind ?? useKitchen.getState().leaderboardKind;
  try {
    const response = await fetch(`/api/leaderboard?kind=${target}`);
    const data = (await response.json()) as { ok?: boolean; board?: unknown };
    if (data.ok && Array.isArray(data.board))
      useKitchen.setState({ leaderboard: data.board as BoardEntry[] });
  } catch {
    /* Best-effort: keep whatever the panel already shows. */
  }
}

export function setLeaderboardKind(kind: LeaderboardKind): void {
  useKitchen.setState({ leaderboardKind: kind });
  void refreshLeaderboard(kind);
}

/** Post the current result to X. Falls back to the last best score when idle. */
export function shareResult(): void {
  const { game, cleared, campaignComplete, best } = useKitchen.getState();
  const outcome = campaignComplete
    ? '全100レベル完走'
    : cleared
      ? `Lv.${game.level}クリア`
      : `Lv.${game.level}に挑戦中`;
  shareToX(`SIDEKICK kitchen ${outcome}！スコア${Math.max(best, game.score)} #SIDEKICKkitchen`);
}
