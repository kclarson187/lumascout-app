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
 * permissions) — this module reads it and then re-injects the two
 * deep-link blocks that the rewriter strips. Result: deep links are
 * guaranteed to be present in the final bundled config no matter what
 * the pre-bundle rewriter does to app.json.
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
const fs = require('fs');
const path = require('path');

const APP_JSON_PATH = path.join(__dirname, 'app.json');

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

module.exports = () => {
  const base = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8')).expo;

  return {
    ...base,
    ios: {
      ...(base.ios || {}),
      associatedDomains: buildIosAssociatedDomains(),
    },
    android: {
      ...(base.android || {}),
      intentFilters: buildAndroidIntentFilters(),
    },
  };
};
