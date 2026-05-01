/**
 * messageTime — Batch #9A helpers that gate messaging timestamps &
 * analytics by the viewer's subscription tier.
 *
 *   Free            → message timestamps are hidden (Pro/Elite perk).
 *   Pro / Elite     → timestamps rendered in the VIEWER'S local
 *                     timezone (device TZ) via toLocaleTimeString /
 *                     toLocaleDateString. Server continues to store
 *                     UTC ISO strings — we only format on display.
 *   Elite (sender)  → additionally unlocks read-receipt rendering
 *                     (handled in ReadReceipt component / backend
 *                     response gating).
 *
 * Tier strings we accept map onto the shape in src/auth.tsx:
 *   'free' | 'pro' | 'elite' | 'comp_pro' | 'comp_elite'
 *   | 'trial_pro' | 'trial_elite'
 */

export type PlanTier =
  | 'free'
  | 'pro'
  | 'elite'
  | 'comp_pro'
  | 'comp_elite'
  | 'trial_pro'
  | 'trial_elite'
  | string
  | null
  | undefined;

/** True when the viewer has Pro-or-higher entitlements (Pro / Elite / comps / trials). */
export function isPaidPlan(plan: PlanTier): boolean {
  if (!plan) return false;
  const p = String(plan).toLowerCase();
  return (
    p === 'pro' ||
    p === 'elite' ||
    p === 'comp_pro' ||
    p === 'comp_elite' ||
    p === 'trial_pro' ||
    p === 'trial_elite'
  );
}

/** True when the viewer is on an Elite tier (real, comp, or trial). */
export function isElitePlan(plan: PlanTier): boolean {
  if (!plan) return false;
  const p = String(plan).toLowerCase();
  return p === 'elite' || p === 'comp_elite' || p === 'trial_elite';
}

/**
 * Render a message timestamp for the given viewer.
 *
 *   - Free viewers: returns '' (no timestamp shown at all; timestamp
 *     analytics are a paid-plan feature).
 *   - Pro / Elite viewers: returns a localized string in their device
 *     timezone.
 *
 * Styles:
 *   'clock'    → "2:14 PM"              (inside message bubbles)
 *   'preview'  → "2:14 PM" same-day / "Wed" past week / "Oct 3" older
 *                (inbox list preview row)
 *   'receipt'  → "2:14 PM"              (Seen receipts)
 */
export function formatMessageTime(
  iso: string | null | undefined,
  plan: PlanTier,
  style: 'clock' | 'preview' | 'receipt' = 'clock',
): string {
  if (!iso) return '';
  if (!isPaidPlan(plan)) return ''; // Free: no timestamps
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  if (style === 'preview') {
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    const dayMs = 86400000;
    const deltaDays = Math.floor((now.getTime() - d.getTime()) / dayMs);
    if (deltaDays >= 0 && deltaDays < 7) {
      return d.toLocaleDateString([], { weekday: 'short' }); // "Wed"
    }
    // Older — absolute short date
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // 'clock' & 'receipt' share the HH:MM local-time formatting
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
