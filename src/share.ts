/**
 * X (Twitter) Web Intent links. No backend, no API keys: the post text is built
 * from local state and the browser opens the compose dialog.
 */
export function tweetUrl(text: string, url: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function shareToX(text: string, url?: string): void {
  const target = url ?? globalThis.location?.origin ?? 'https://jev-kitchen.egahika.dev';
  globalThis.open?.(tweetUrl(text, target), '_blank', 'noopener,noreferrer');
}
