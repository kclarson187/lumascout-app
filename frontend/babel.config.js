/**
 * babel.config.js — Batch #9 (May 2026)
 *
 * Previously this project relied on Expo's built-in Babel preset with no
 * custom overrides. This file now adds ONE production-only plugin:
 *
 *   babel-plugin-transform-remove-console
 *     Strips every `console.log()` and `console.warn()` from the final
 *     bundle when NODE_ENV === 'production'. `console.error` is kept
 *     so real runtime crashes / handled exceptions still surface to
 *     the native system log (and any crash reporter we wire up later).
 *
 *     In development (and in Jest), the plugin is NOT applied — so
 *     every existing debug log continues to print during EAS dev builds,
 *     Expo Go sessions, and unit tests.
 *
 * Safe-by-default: if NODE_ENV is unset (can happen in one-off tooling),
 * the env key below degrades gracefully to development behaviour.
 *
 * Do NOT add more plugins here without reviewing Metro cache / Reanimated
 * worklet hoisting implications.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: {
      production: {
        plugins: [
          // Strip console.log + console.warn; KEEP console.error so real
          // production crashes still trace. `exclude` lets us preserve
          // specific calls if we tag them (not used today, but ready).
          ['transform-remove-console', { exclude: ['error'] }],
        ],
      },
    },
  };
};
