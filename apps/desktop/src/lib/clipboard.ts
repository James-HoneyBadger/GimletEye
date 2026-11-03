/**
 * The system clipboard.
 *
 * The window denies every permission request, which includes the web clipboard,
 * so the desktop's own clipboard is reached through the preload. The web API is
 * the fallback for a build without the bridge (and for tests).
 */
export async function copyText(text: string): Promise<void> {
  const bridge = typeof window === 'undefined' ? undefined : window.gimletWorks;
  if (bridge?.copy) {
    await bridge.copy(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}
