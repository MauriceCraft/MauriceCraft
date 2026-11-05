/** Make failed initialization recoverable without deleting saved worlds. */
export function describeStartupFailure(error: unknown): string {
  if (error instanceof Error && /webgl|context|canvas/i.test(error.message)) {
    return 'Your browser could not start the 3D renderer. Check that graphics acceleration is available, then reload.';
  }
  return 'The game could not finish loading. Reload to try again. Your saved worlds have not been deleted.';
}

/**
 * The page initially shows a disabled Loading button. If startup crashes,
 * always replace that state with an actionable Reload button and explanation.
 */
export function showStartupFailure(error: unknown): void {
  console.error('MauriceCraft startup failed:', error);
  const playButton = document.getElementById('play');
  const status = document.getElementById('sub');
  if (status) status.textContent = describeStartupFailure(error);
  if (!(playButton instanceof HTMLButtonElement)) return;
  playButton.disabled = false;
  playButton.textContent = 'Reload game';
  playButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.reload();
  }, { capture: true });
}
