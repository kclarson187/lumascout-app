/**
 * Frontend feature flags.
 *
 * Single source of truth for in-flight features. Flip a flag to false to
 * instantly revert to the prior behavior without touching screens or
 * backend — useful as a fast rollback lever during a phased rollout.
 */

// Phase 1 onboarding v2 (Jun 2025). When true:
//   • register screen shows the premium adaptive social auth UI with
//     an "Apple — Coming soon" stub button.
//   • newly registered email users are routed to /onboarding/basics
//     before the /(tabs) home, instead of being dropped straight in.
//   • login screen shows the matching Apple stub for visual parity.
// Existing users are grandfathered server-side (see
// `_compute_basics_complete` in backend/server.py) and never bounced
// back through onboarding, regardless of this flag.
export const ONBOARDING_V2_ENABLED = true;
