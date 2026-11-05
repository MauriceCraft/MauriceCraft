/** The static menu must never remain stuck on its initial "Loading…" state.
 *
 * If module setup or world initialization fails, show a retry action without
 * deleting, resetting, or overwriting any worlds in IndexedDB.
 */
function menuElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function showStartupFailure(error: unknown, explanation?: string): void {
  console.error('MauriceCraft startup failed:', error);
  const overlay = menuElement<HTMLElement>('overlay');
  const subtitle = menuElement<HTMLElement>('sub');
  const play = menuElement<HTMLButtonElement>('play');
  const createWorld = menuElement<HTMLButtonElement>('newworld');

  if (overlay) overlay.style.display = 'block';
  if (subtitle) subtitle.textContent = explanation ??
    'Unable to load the game. Your saved worlds have not been deleted. Try reloading this page.';
  if (createWorld) createWorld.disabled = true;
  if (!play) return;

  // Drop any previously attached "Play" handler so Retry cannot accidentally
  // enter a half-initialized game before the page reloads.
  const retryButton = play.cloneNode(true) as HTMLButtonElement;
  retryButton.textContent = 'Retry loading';
  retryButton.disabled = false;
  retryButton.dataset.startupError = 'true';
  retryButton.addEventListener('click', () => window.location.reload());
  play.replaceWith(retryButton);
}

/** Device-specific IndexedDB / WebGL stalls should be diagnosable, not silent. */
export function monitorStartup(timeoutMilliseconds = 20_000): void {
  window.setTimeout(() => {
    const play = menuElement<HTMLButtonElement>('play');
    if (!play || !play.disabled || play.dataset.startupError === 'true') return;
    const subtitle = menuElement<HTMLElement>('sub');
    if (subtitle?.textContent?.startsWith('Could not load this world')) return;
    showStartupFailure(
      new Error('Startup did not finish within ' + timeoutMilliseconds + 'ms'),
      'This device is taking too long to load the game. You can retry. Saved worlds are unchanged.',
    );
  }, timeoutMilliseconds);
}
