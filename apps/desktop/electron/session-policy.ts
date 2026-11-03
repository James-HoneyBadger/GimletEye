import type { Session } from 'electron';

/**
 * Schemes this window may load.
 *
 * The app is a local document: `file:` for the bundle, `data:` for the inline
 * icon, `blob:` for a downloaded report. `devtools:` is the inspector's own
 * scheme, which only this process can open. Everything else is cancelled, so
 * "no telemetry, no network" is enforced by the session rather than inferred
 * from there being no `fetch` in the source.
 *
 * `chrome-extension:` used to be here too. No extension is ever loaded into this
 * session — `app.enableSandbox()` with no `extensions` path leaves none — so the
 * entry only widened what a future change could reach.
 */
export const LOCAL_SCHEME = /^(file|data|blob|devtools):/i;

export function isLocalScheme(url: string): boolean {
  return LOCAL_SCHEME.test(url);
}

/**
 * Deny the window its capabilities at the session, once.
 *
 * Written as a function over the session so a test can drive it with a fake one:
 * the policy is a security claim, and a claim with no test behind it is a comment.
 */
export function installSessionPolicy(session: Session): void {
  // A report renderer needs no camera, microphone, notification, or clipboard
  // read; denying them all is cheaper than auditing each use.
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);

  // The session, not the source, is what guarantees no request leaves.
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isLocalScheme(details.url) });
  });
}
