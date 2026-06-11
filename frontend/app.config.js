/**
 * app.config.js — Dynamic Expo configuration that guarantees the
 * Universal Links / App Links configuration survives the Emergent
 * deploy pipeline.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Emergent's deploy builder has an `app.json` rewriter that runs before
 * `expo export`. During a prior failed deploy we saw:
 *
 *   [EAS_LOG] Removing android.intentFilters (handled by plugins)
 *   [EAS_LOG] Removing ios.associatedDomains (handled by plugins)
 *
 * i.e. the rewriter unconditionally strips these two keys from the
 * static app.json. If we left the deep-link config there, every deploy
 * would silently break `/spot/{id}`, `/user/*`, `/collection/*`,
 * `/community/*`, and `/marketplace/*` Universal Links.
 *
 * Expo CLI prefers a dynamic config (this file) over the static
 * app.json when both exist. The static file stays as the source of
 * truth for stable fields (name, version, plugins, splash, icons,
 * permissions) — this module receives the merged base config from
 * Expo and re-injects the two deep-link blocks that the rewriter
 * strips. Result: deep links are guaranteed to be present in the
 * final bundled config no matter what the pre-bundle rewriter does
 * to app.json.
 *
 * V2 (2026-05-03) — EAS deploy fix
 * ---------------------------------
 * Previous version manually read `app.json` with fs.readFileSync and
 * returned a fresh object. This triggered `expo-doctor`'s
 *   "Check Expo config for common issues"
 * failure on the EAS build server: "You have an app.json file in your
 * project, but your app.config.js is not using the values from it."
 *
 * Expo's expected pattern for dynamic configs is to accept `{ config }`
 * as the first argument of the exported function — Expo internally
 * loads app.json, merges it with any base config, and passes the
 * result in. Manually reading app.json bypasses that pipeline and
 * confuses doctor's static analysis even though the runtime result
 * is identical.
 *
 * Rewriting to the `({ config }) => ({ ...config, ios: ..., android: ... })`
 * pattern keeps the exact same runtime behaviour (deep links injected
 * after Expo loads app.json) while passing expo-doctor.
 *
 * HOSTS
 * -----
 * Production domain: https://lumascout.app
 * Supported shareable paths:
 *   /spot/{id}         · shared photoshoot spot detail
 *   /user/{username}   · creator profile
 *   /collection/{id}   · curated collection
 *   /community/{id}    · community post
 *   /marketplace/{id}  · marketplace listing
 */

// Pulls Universal Links / App Links config out into one place so
// the iOS and Android sides stay in sync.
const LUMASCOUT_HOST = 'lumascout.app';
const DEEP_LINK_PATHS = ['/spot', '/user', '/collection', '/community', '/marketplace'];

// V3 (May 2026) — production-build BACKEND URL injection.
//
// `.env` is gitignored (correctly — secrets shouldn't be committed),
// so when EAS runs `expo export` on its build server the `.env` file
// isn't there and `process.env.EXPO_PUBLIC_BACKEND_URL` is undefined
// in the bundled JS. The dev preview app worked because Metro reads
// `.env` from the local filesystem at dev-server start; production
// builds had no such luck and silently fell back to relative URLs
// (`/api/uploads/...`), which React Native's <Image> can't render.
// Symptom: Explore tab thumbnails missing in production but fine in
// Expo Go. (Reported May 2026.)
//
// We now mirror the value into `extra.EXPO_PUBLIC_BACKEND_URL` so
// `Constants.expoConfig.extra` always carries it, even when the
// `.env` file isn't present. Frontend helpers
// (`src/utils/image-url.ts`, `src/utils/upload-image.ts`) already
// fall back to `Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL`
// when `process.env.…` is undefined, so this single injection fixes
// every code path that reads the backend URL.
// June 2026 deploy fix: pin to the permanent production host
// (`*.emergent.host`), NOT the ephemeral preview URL. Emergent's deploy
// pipeline rewrites `.env`'s `EXPO_PUBLIC_BACKEND_URL` to
// `photo-finder-60.emergent.host` at build time (visible in deploy
// STEP 3 logs). This hardcoded fallback now matches that host so the
// "iOS upgrade Constants.extra cache miss + no env var" worst case
// still hits a live backend instead of a rotated preview pod.
const PROD_BACKEND_URL = 'https://photo-finder-60.emergent.host';
const PROD_WEB_BASE_URL = 'https://lumascout.app';

function resolvedBackendUrl() {
  // Honor the live env var first (so dev/staging EAS profiles can
  // override). Fall back to the production URL when nothing is set —
  // EAS production builds ship without `.env` on the build server.
  return (process.env.EXPO_PUBLIC_BACKEND_URL || PROD_BACKEND_URL).replace(/\/+$/, '');
}
function resolvedWebBaseUrl() {
  return (process.env.EXPO_PUBLIC_WEB_BASE_URL || PROD_WEB_BASE_URL).replace(/\/+$/, '');
}

function buildAndroidIntentFilters() {
  return [
    {
      action: 'VIEW',
      autoVerify: true,
      data: DEEP_LINK_PATHS.map((p) => ({
        scheme: 'https',
        host: LUMASCOUT_HOST,
        pathPrefix: p,
      })),
      category: ['BROWSABLE', 'DEFAULT'],
    },
  ];
}

function buildIosAssociatedDomains() {
  // applinks:<host> enables Universal Links. The iOS OS downloads
  // https://lumascout.app/.well-known/apple-app-site-association on
  // install/update and maps matching paths into this app.
  return [`applinks:${LUMASCOUT_HOST}`];
}

module.exports = ({ config }) => {
  // `config` here is Expo's merged result: app.json → expo.* fields
  // auto-loaded by the CLI, plus any base we might receive from a
  // parent config tool. We spread it and overlay only the two blocks
  // that the Emergent rewriter strips (see module header).
  const backendUrl = resolvedBackendUrl();
  const webBaseUrl = resolvedWebBaseUrl();
  return {
    ...config,
    ios: {
      ...(config.ios || {}),
      associatedDomains: buildIosAssociatedDomains(),
    },
    android: {
      ...(config.android || {}),
      intentFilters: buildAndroidIntentFilters(),
    },
    extra: {
      // Preserve everything app.json already declared (router, eas
      // projectId, privacyPolicyUrl, etc.).
      ...(config.extra || {}),
      // Fix for production-build "blank thumbnails" regression
      // reported May 2026 — see V3 note above. These two values must
      // be present in the bundled JS so `Constants.expoConfig.extra`
      // works as a fallback when `process.env.EXPO_PUBLIC_…` is
      // missing (which it is on the EAS build server because `.env`
      // is gitignored).
      EXPO_PUBLIC_BACKEND_URL: backendUrl,
      EXPO_PUBLIC_WEB_BASE_URL: webBaseUrl,
    },
  };
};
