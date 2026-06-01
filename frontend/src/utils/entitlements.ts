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
