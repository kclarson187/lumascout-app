/**
 * Centralized entitlement / plan-tier helpers.
 *
 * The backend supports a richer set of plan tiers than the original frontend
 * type definition allowed (free / pro / elite plus comp_pro, comp_elite,
 * trial_pro, trial_elite). On top of that, users with role === 'admin' should
 * have full Pro/Elite access regardless of their billing plan.
 *
 * Use these helpers anywhere we previously did `plan === 'pro' || plan === 'elite'`.
 */

export type PlanTier =
  | 'free'
  | 'pro'
  | 'elite'
  | 'comp_pro'
  | 'comp_elite'
  | 'trial_pro'
  | 'trial_elite';

type EntitlementUser = {
  plan?: string | null;
  role?: string | null;
} | null | undefined;

const PRO_PLANS = new Set(['pro', 'comp_pro', 'trial_pro']);
const ELITE_PLANS = new Set(['elite', 'comp_elite', 'trial_elite']);
const COMP_PLANS = new Set(['comp_pro', 'comp_elite']);
const PAID_PLANS = new Set([
  'pro',
  'elite',
  'comp_pro',
  'comp_elite',
  'trial_pro',
  'trial_elite',
]);

/** True when the user has any paid-tier entitlement OR is an admin. */
export function isPaid(user: EntitlementUser): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  return !!user.plan && PAID_PLANS.has(user.plan);
}

/** True for Pro tier or higher (incl. Elite, comp, trial, admin). */
export function isPro(user: EntitlementUser): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  if (!user.plan) return false;
  return PRO_PLANS.has(user.plan) || ELITE_PLANS.has(user.plan);
}

/** True for Elite tier specifically (incl. comp_elite, trial_elite, admin). */
export function isElite(user: EntitlementUser): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'super_admin') return true;
  if (!user.plan) return false;
  return ELITE_PLANS.has(user.plan);
}

/** True if the plan is complimentary (admin-granted). */
export function isComp(user: EntitlementUser): boolean {
  if (!user || !user.plan) return false;
  return COMP_PLANS.has(user.plan);
}

/** True if the user is an admin (any flavor). */
export function isAdmin(user: EntitlementUser): boolean {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'super_admin';
}

/**
 * Resolve a user to one of the four canonical weather/feature tiers:
 *   'anon' | 'free' | 'pro' | 'elite'
 *
 * Mirrors the backend `_resolve_user_tier()` in routes/weather.py so the
 * UI can predict what the server will return (useful for dev logs /
 * sanity checks). The backend remains the source of truth — never use
 * this to UNLOCK a paid feature client-side, only to detect mismatches.
 *
 * Resolution order:
 *   1. Admin / super_admin role → 'elite'
 *   2. comp_elite / trial_elite → 'elite'
 *   3. comp_pro / trial_pro     → 'pro'
 *   4. Active paid plan         → 'pro' | 'elite'
 *   5. Logged in, no entitlement → 'free'
 *   6. Anonymous                → 'anon'
 */
export function effectiveTier(
  user: EntitlementUser,
): 'anon' | 'free' | 'pro' | 'elite' {
  if (!user) return 'anon';
  if (isAdmin(user)) return 'elite';
  const plan = (user.plan || '').toString();
  if (ELITE_PLANS.has(plan)) return 'elite';
  if (PRO_PLANS.has(plan)) return 'pro';
  return 'free';
}

/**
 * Pretty label for a user's effective plan badge:
 * - Admins → "ADMIN"
 * - comp_* → "ELITE • COMP" / "PRO • COMP"
 * - trial_* → "ELITE • TRIAL" / "PRO • TRIAL"
 * - default → uppercased plan
 */
export function planLabel(user: EntitlementUser): string {
  if (!user) return 'FREE';
  if (isAdmin(user)) return 'ADMIN';
  const plan = user.plan ?? 'free';
  switch (plan) {
    case 'comp_pro':
      return 'PRO • COMP';
    case 'comp_elite':
      return 'ELITE • COMP';
    case 'trial_pro':
      return 'PRO • TRIAL';
    case 'trial_elite':
      return 'ELITE • TRIAL';
    default:
      return plan.toUpperCase();
  }
}


// ════════════════════════════════════════════════════════════════════
// FEATURE CATALOG (Jun 2026)
// ════════════════════════════════════════════════════════════════════
//
// Canonical mapping of feature-key → minimum tier required. Every
// premium gate in the app should read from this table instead of
// scattering hard-coded plan checks across the codebase.
//
// Tiers: 'free' (anyone, incl. anon) · 'pro' · 'elite'
// Comp / admin / super_admin users resolve to 'elite' via effectiveTier().
//
// Usage:
//   if (!canUseFeature(user, 'weather_10_day')) {
//     router.push({ pathname: '/paywall',
//                   params: { reason: 'weather_10_day' } });
//     return;
//   }
//   const tier = getFeatureRequiredTier('sun_path');  // → 'elite'
//
export type FeatureKey =
  // saves / collections
  | 'save_spot'
  | 'unlimited_saves'
  | 'collections'
  | 'route_planning'
  | 'advanced_filters'
  | 'profile_analytics'
  // weather
  | 'weather_current'
  | 'weather_hourly'
  | 'weather_5_day'
  | 'weather_10_day'
  | 'weather_overlays'
  | 'sun_path'
  | 'sunrise_sunset_precision'
  | 'crowd_prediction'
  | 'seasonal_tracking'
  // discovery / community
  | 'hidden_gems'
  | 'priority_support';

const FEATURE_TIER: Record<FeatureKey, 'free' | 'pro' | 'elite'> = {
  // Free
  save_spot:               'free',  // limited to 3 — backend enforces count
  weather_current:         'free',
  // Pro
  unlimited_saves:         'pro',
  collections:             'pro',
  route_planning:          'pro',
  advanced_filters:        'pro',
  profile_analytics:       'pro',
  weather_hourly:          'pro',
  weather_5_day:           'pro',
  weather_overlays:        'pro',
  // Elite
  weather_10_day:          'elite',
  sun_path:                'elite',
  sunrise_sunset_precision:'elite',
  crowd_prediction:        'elite',
  seasonal_tracking:       'elite',
  hidden_gems:             'elite',
  priority_support:        'elite',
};

/** Lowest tier that unlocks the given feature. */
export function getFeatureRequiredTier(feature: FeatureKey): 'free' | 'pro' | 'elite' {
  return FEATURE_TIER[feature] ?? 'pro';
}

/**
 * Check if a user can use a specific gated feature. Trusts the
 * frontend tier resolution (mirrors backend `_resolve_user_tier`).
 *
 * The backend remains the source of truth — never use this to
 * UNLOCK paid content client-side; only to render UI optimistically
 * and to pick the right paywall reason copy.
 */
export function canUseFeature(user: EntitlementUser, feature: FeatureKey): boolean {
  const required = getFeatureRequiredTier(feature);
  const tier = effectiveTier(user);   // 'anon' | 'free' | 'pro' | 'elite'
  if (required === 'free') return true;
  if (required === 'pro')   return tier === 'pro'   || tier === 'elite';
  if (required === 'elite') return tier === 'elite';
  return false;
}

/** Cleaner alias matching the spec's `getUserTier()` naming. */
export function getUserTier(user: EntitlementUser): 'anon' | 'free' | 'pro' | 'elite' {
  return effectiveTier(user);
}

/** True if the user has Pro-or-higher access (Pro, Elite, comp, admin). */
export function hasProAccess(user: EntitlementUser): boolean {
  const t = effectiveTier(user);
  return t === 'pro' || t === 'elite';
}

/** True if the user has Elite access (Elite, comp_elite, admin). */
export function hasEliteAccess(user: EntitlementUser): boolean {
  return effectiveTier(user) === 'elite';
}

// ─── Upgrade prompt copy ────────────────────────────────────────────
//
// High-intent moments call upgradeCopyForFeature(feature) to get a
// photographer-first one-liner. Generic SaaS copy like "Upgrade
// required" is intentionally avoided.
//
const UPGRADE_COPY: Record<FeatureKey, string> = {
  save_spot:               'Save unlimited spots and organize them into Collections with Pro.',
  unlimited_saves:         'You\u2019ve hit the 3-spot Free limit. Unlock unlimited saves with Pro.',
  collections:             'Organize your spots into custom Collections with Pro.',
  route_planning:          'Plan multi-stop shoot routes around golden hour with Pro.',
  advanced_filters:        'Filter by light direction, terrain, and seasonal conditions with Pro.',
  profile_analytics:       'See who\u2019s viewing your spots and which uploads land with Pro.',
  weather_current:         '',  // no upsell — current weather is Free
  weather_hourly:          'Plan your shoot hour-by-hour with Pro.',
  weather_5_day:           'Unlock 5-day weather planning, unlimited saved spots, collections, route planning, and advanced filters with Pro.',
  weather_10_day:          'Unlock 10-day weather planning, exact sun path tools, crowd predictions, and seasonal location insights with Elite.',
  weather_overlays:        'See cloud cover, precipitation, and wind overlays on the map with Pro.',
  sun_path:                'Plan the exact sun angle and shadow direction for any spot, any day, with Elite.',
  sunrise_sunset_precision:'Get the precise golden-hour window for any location with Elite\u2019s sunrise/sunset planner.',
  crowd_prediction:        'See how crowded a spot is likely to be at any time with Elite.',
  seasonal_tracking:       'Track bloom seasons, fall color, and seasonal conditions with Elite.',
  hidden_gems:             'Get first access to newly discovered hidden gems with Elite.',
  priority_support:        'Priority support is included with Elite.',
};

/** Photographer-first upgrade copy for a specific feature. */
export function upgradeCopyForFeature(feature: FeatureKey): string {
  return UPGRADE_COPY[feature] || 'Unlock this with Pro or Elite.';
}

/** Friendly plan-summary line for the Settings / account screen. */
export function planSummaryCopy(user: EntitlementUser): string {
  const t = effectiveTier(user);
  if (t === 'elite') {
    return "You\u2019re on Elite. You have the full LumaScout planning suite, including 10-day weather, sun path tools, seasonal insights, hidden gem early access, and priority support.";
  }
  if (t === 'pro') {
    return "You\u2019re on Pro. You have unlimited saves, collections, route planning, advanced filters, profile analytics, and 5-day weather planning.";
  }
  return "You\u2019re on Free. Scout locations, upload spots, join the community, and save up to 3 places.";
}
