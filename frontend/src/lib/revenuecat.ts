/**
 * src/lib/revenuecat.ts — RevenueCat singleton wrapper
 * ═══════════════════════════════════════════════════════════
 *
 * Jun 2026 — Apple App Store Guideline 3.1.1 compliance.
 *
 * iOS subscriptions go through Apple In-App Purchase via RevenueCat.
 * Stripe is preserved for web / Android / marketplace / referrals.
 *
 * This module is the ONLY place that imports `react-native-purchases`.
 * Every other file uses these typed helpers, which:
 *   • degrade gracefully when RevenueCat isn't configured yet (placeholder
 *     API key) — no crashes, just `configured: false`
 *   • degrade gracefully in Expo Go (the native module is absent) —
 *     same `configured: false` path
 *   • are no-ops on non-iOS platforms (web/Android keep using Stripe
 *     for now; we can flip Android on later by also wiring the
 *     ANDROID public key + Play Billing products)
 *
 * Architecture:
 *
 *   App Boot:
 *     1. Fetch /api/billing/iap-config (public, no auth) → cache locally
 *     2. If configured && Platform.OS === 'ios' → Purchases.configure()
 *
 *   After Login:
 *     3. Purchases.logIn(user.user_id) so RC ties subscriptions to our
 *        own user identity (NOT an anonymous device-scoped ID).
 *
 *   Paywall:
 *     4. getOfferings() → render packages
 *     5. purchasePackage(pkg) → on success, refresh customerInfo, also
 *        call /api/auth/me to refresh our backend plan (RC webhook will
 *        also fire from RC servers).
 *
 *   Restore button:
 *     6. restorePurchases() → on success refresh plan
 *
 *   Logout:
 *     7. Purchases.logOut() (best effort; safe to skip)
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from '../api';

// ─── Dynamic import — guarded against Expo Go / web ───────────────
// `react-native-purchases` ships a native module that is unavailable
// in Expo Go and on web. We require() it lazily inside a try/catch
// so importing this file never crashes the bundle. Callers detect
// availability via `isRevenueCatAvailable()`.
let Purchases: any = null;
let _modImportTried = false;

function getPurchases(): any | null {
  if (_modImportTried) return Purchases;
  _modImportTried = true;
  // Only attempt on native platforms — react-native-purchases throws
  // on the web bundle import path.
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Purchases = require('react-native-purchases').default;
    return Purchases;
  } catch (e) {
    // Expo Go: native module not linked → require returns a broken obj.
    // Don't log — this is the normal Expo-Go-dev case.
    return null;
  }
}

// ─── Types ─────────────────────────────────────────────────────────
export type RcTier = 'free' | 'pro' | 'elite';

export interface IapConfig {
  ios: {
    configured:    boolean;
    api_key:       string | null;
    entitlements:  string[];
    offering_id:   string;
    product_ids:   Record<string, string>;
  };
  stripe_platforms: string[];
  ios_iap_enabled:  boolean;
}

// ─── State ─────────────────────────────────────────────────────────
let _cachedConfig: IapConfig | null = null;
let _configuredOnce = false;

// ─── Public API ────────────────────────────────────────────────────

/**
 * True if `react-native-purchases` is loaded AND the iOS public key
 * is set (not the sentinel placeholder). On Android/web this is
 * always false — those platforms keep using Stripe for now.
 */
export function isRevenueCatAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  if (!getPurchases()) return false;
  return !!(_cachedConfig?.ios.configured);
}

/**
 * Whether we should try to render the IAP paywall on this device.
 * True only on iOS WITH a configured RC SDK. Web/Android falls back
 * to Stripe Checkout. iOS without config falls back to a polite
 * "in-app purchases not yet available — please contact support" UI.
 */
export function shouldUseIapForPurchases(): boolean {
  return isRevenueCatAvailable();
}

/**
 * Fetch and cache the IAP config from the backend, then initialize
 * the RevenueCat SDK if appropriate. Safe to call multiple times —
 * the SDK is only configured once per app session.
 *
 * Returns the config so callers can render UI based on it.
 */
export async function bootRevenueCat(): Promise<IapConfig | null> {
  try {
    const cfg: IapConfig = await api.get('/billing/iap-config');
    _cachedConfig = cfg;

    // No-op on Android/web for now (keep Stripe).
    if (Platform.OS !== 'ios') return cfg;
    if (!cfg.ios.configured || !cfg.ios.api_key) return cfg;

    const Pkg = getPurchases();
    if (!Pkg) return cfg; // Expo Go — render gracefully degraded UI.
    if (_configuredOnce) return cfg;

    // Debug logs in dev only — RC docs recommend ERROR-only in prod.
    try {
      const isDev = __DEV__;
      if (Pkg.LOG_LEVEL && Pkg.setLogLevel) {
        Pkg.setLogLevel(isDev ? Pkg.LOG_LEVEL.DEBUG : Pkg.LOG_LEVEL.ERROR);
      }
    } catch { /* SDK lacks setLogLevel — fine */ }

    await Pkg.configure({ apiKey: cfg.ios.api_key });
    _configuredOnce = true;
    return cfg;
  } catch (e) {
    // Backend unreachable or 500 — render Stripe fallback on iOS too.
    // (Better to let users buy via web than block them.)
    return null;
  }
}

/**
 * Tie the current RevenueCat anonymous user to our own user_id so
 * the RC dashboard, webhooks, and entitlement reads all use the
 * same identifier. Safe to call repeatedly.
 *
 * No-op if RC isn't configured / not iOS / Expo Go.
 */
export async function identifyRevenueCatUser(userId: string): Promise<void> {
  if (!isRevenueCatAvailable()) return;
  const Pkg = getPurchases();
  if (!Pkg) return;
  try {
    await Pkg.logIn(userId);
  } catch (e) {
    // Don't propagate — login flow shouldn't break because of an RC
    // identity hiccup. The next purchase will retry.
    if (__DEV__) console.warn('[revenuecat] logIn failed', e);
  }
}

/**
 * Reset RevenueCat to an anonymous user. Called from auth logout.
 * Safe no-op if RC isn't available.
 */
export async function logoutRevenueCatUser(): Promise<void> {
  if (!isRevenueCatAvailable()) return;
  const Pkg = getPurchases();
  if (!Pkg) return;
  try {
    await Pkg.logOut();
  } catch (e) {
    if (__DEV__) console.warn('[revenuecat] logOut failed', e);
  }
}

/**
 * Fetch the currently active offering for the user.
 * Returns `null` if RC isn't available, the user has no current
 * offering, or the fetch failed.
 *
 * The returned packages each have a `.product.priceString` (already
 * localized to the user's region) and a `.product.identifier` that
 * we use to map back to our `pro_monthly | pro_annual | elite_monthly
 * | elite_annual` slugs.
 */
export async function fetchOfferings(): Promise<any | null> {
  if (!isRevenueCatAvailable()) return null;
  const Pkg = getPurchases();
  if (!Pkg) return null;
  try {
    const offerings = await Pkg.getOfferings();
    return offerings?.current || null;
  } catch (e) {
    if (__DEV__) console.warn('[revenuecat] getOfferings failed', e);
    return null;
  }
}

export type PurchaseResult =
  | { ok: true; entitlements: string[]; tier: RcTier }
  | { ok: false; userCancelled: true }
  | { ok: false; error: string };

/**
 * Purchase a RevenueCat package. The package object comes from
 * fetchOfferings().availablePackages[i]. On success, the caller
 * should also refresh /api/auth/me so the backend plan is reflected
 * locally (the RC webhook to our backend will fire from RC servers
 * within seconds, but the client can be optimistic).
 */
export async function purchasePackage(pkg: any): Promise<PurchaseResult> {
  if (!isRevenueCatAvailable()) {
    return { ok: false, error: 'iap_not_available' };
  }
  const Pkg = getPurchases();
  if (!Pkg) return { ok: false, error: 'iap_not_available' };
  try {
    const { customerInfo } = await Pkg.purchasePackage(pkg);
    const active = Object.keys(customerInfo?.entitlements?.active || {});
    const tier: RcTier =
      active.includes('elite') ? 'elite' :
      active.includes('pro')   ? 'pro'   : 'free';
    return { ok: true, entitlements: active, tier };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, userCancelled: true };
    return { ok: false, error: String(e?.message || e || 'purchase_failed') };
  }
}

/**
 * Restore previously purchased entitlements for the currently signed-in
 * Apple ID. Apple REQUIRES a user-initiated "Restore Purchases" button
 * for any non-consumable IAPs.
 */
export async function restorePurchases(): Promise<PurchaseResult> {
  if (!isRevenueCatAvailable()) {
    return { ok: false, error: 'iap_not_available' };
  }
  const Pkg = getPurchases();
  if (!Pkg) return { ok: false, error: 'iap_not_available' };
  try {
    const customerInfo = await Pkg.restorePurchases();
    const active = Object.keys(customerInfo?.entitlements?.active || {});
    const tier: RcTier =
      active.includes('elite') ? 'elite' :
      active.includes('pro')   ? 'pro'   : 'free';
    return { ok: true, entitlements: active, tier };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || 'restore_failed') };
  }
}

/**
 * Lightweight cache accessor — returns whatever we last fetched
 * from /api/billing/iap-config, or null if bootRevenueCat hasn't
 * run yet.
 */
export function getCachedIapConfig(): IapConfig | null {
  return _cachedConfig;
}

/**
 * Map a RevenueCat product identifier back to our tier+cycle slug.
 * Falls back gracefully if the product ID doesn't match any known
 * pattern (e.g. promotional SKUs we add in the dashboard later).
 */
export function classifyProductId(productId: string): {
  tier: 'pro' | 'elite';
  cycle: 'monthly' | 'annual';
} | null {
  if (!productId) return null;
  const id = productId.toLowerCase();
  const tier: 'pro' | 'elite' = id.includes('elite') ? 'elite' : 'pro';
  const cycle: 'monthly' | 'annual' =
    (id.includes('annual') || id.includes('yearly') || id.includes('year'))
      ? 'annual' : 'monthly';
  return { tier, cycle };
}

// Constants helper — useful for QA/debugging
export function getBundleId(): string | undefined {
  return Constants.expoConfig?.ios?.bundleIdentifier;
}
