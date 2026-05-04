/**
 * Runtime constants — hardcoded production values that survive every
 * layer of the build pipeline. Used as the TERMINAL fallback when
 * env vars and Constants.expoConfig.extra are both unavailable.
 *
 * WHY THIS EXISTS
 * ---------------
 * May 2026 production-build image regression RCA (troubleshoot_agent
 * 2nd pass):
 *
 *   1. `.env` is gitignored — EAS build server never sees it →
 *      `process.env.EXPO_PUBLIC_*` undefined in the bundled JS.
 *   2. `app.config.js` DOES inject `extra.EXPO_PUBLIC_BACKEND_URL`
 *      correctly, but iOS caches `Constants.expoConfig.extra` in the
 *      native binary on first install. Subsequent updates do NOT
 *      refresh those values (Expo SDK 50–54 known bug,
 *      expo/expo#33692) unless the user fully uninstalls and
 *      reinstalls the app — something we cannot ask end-users to do
 *      every release.
 *   3. Without a working fallback, image helpers get empty strings
 *      for the backend URL, try to load `<Image source={{ uri: '/api/img?u=…' }} />`
 *      (relative), iOS silently refuses, thumbnails go blank.
 *
 * HARDCODING (below) sidesteps the entire dependency chain:
 * `eas.json` env injection → process.env → `extra` mirror → hardcoded.
 * The app works NO MATTER WHICH of those layers fail.
 *
 * TRADE-OFFS
 * ----------
 * • If we ever cut over to a new canonical backend domain, we MUST
 *   bump this constant and ship a new build. That's fine — this is
 *   a "known production URL" not a secret.
 * • For staging/preview EAS profiles, the higher-priority layers
 *   (env var or `extra`) still win, so this only kicks in when the
 *   others are empty — which in practice is only the failing iOS
 *   upgrade scenario.
 */

/** Canonical production backend host. Serves /api, /api/img, /api/uploads. */
export const PRODUCTION_BACKEND_URL = 'https://photo-finder-60.preview.emergentagent.com';

/** Canonical production web origin — used for share URLs + OG cards. */
export const PRODUCTION_WEB_BASE_URL = 'https://lumascout.app';

/**
 * Resolve the backend base URL for any frontend helper.
 *
 * Priority (first non-empty wins):
 *   1. `process.env.EXPO_PUBLIC_BACKEND_URL`     — Metro-inlined at
 *      build time when `eas.json` has an `env` section on the
 *      build profile, OR when `.env` is on the build server.
 *   2. `Constants.expoConfig.extra.EXPO_PUBLIC_BACKEND_URL` —
 *      injected by our dynamic `app.config.js`. Works on fresh
 *      installs; fails on iOS upgrades (see header).
 *   3. `PRODUCTION_BACKEND_URL` (hardcoded above) — ultimate
 *      fallback, always works.
 *
 * Every call-site should use this helper instead of rolling their own
 * env-var plumbing so we stay consistent with the fallback chain.
 */
export function resolveBackendUrl(): string {
  try {
    // Lazy require so this module has no side-effects on import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default;
    const fromEnv = (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) || '';
    const fromExtra = (Constants?.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL as string | undefined) || '';
    const resolved = fromEnv || fromExtra || PRODUCTION_BACKEND_URL;
    return resolved.replace(/\/+$/, '');
  } catch {
    return PRODUCTION_BACKEND_URL;
  }
}

/** Same semantics for the web origin (share URLs). */
export function resolveWebBaseUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default;
    const fromEnv = (process.env.EXPO_PUBLIC_WEB_BASE_URL as string | undefined) || '';
    const fromExtra = (Constants?.expoConfig?.extra?.EXPO_PUBLIC_WEB_BASE_URL as string | undefined) || '';
    const resolved = fromEnv || fromExtra || PRODUCTION_WEB_BASE_URL;
    return resolved.replace(/\/+$/, '');
  } catch {
    return PRODUCTION_WEB_BASE_URL;
  }
}
