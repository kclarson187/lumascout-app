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
  };
};
