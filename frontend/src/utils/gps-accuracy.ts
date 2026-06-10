/**
 * GPS accuracy formatting + badge classification.
 *
 * Phase 2 — Add Location Optimization (Jun 2026).
 *
 * Used by the Fast Add "Confirm the pin" card so the photographer
 * gets a glanceable read of how trustworthy the GPS fix is. Lower
 * radius = tighter pin = green. Higher radius = looser pin = warn.
 *
 * We intentionally keep this in meters as the primary unit (matches
 * the OS APIs) and surface feet in parens for US-region drafts since
 * that's our largest user segment.
 */

export type AccuracyTier = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

const FEET_PER_METER = 3.28084;

export function accuracyTier(meters?: number | null): AccuracyTier {
  if (meters == null || Number.isNaN(meters) || meters <= 0) return 'unknown';
  if (meters <= 10) return 'excellent';
  if (meters <= 25) return 'good';
  if (meters <= 75) return 'fair';
  return 'poor';
}

export function accuracyLabel(tier: AccuracyTier): string {
  switch (tier) {
    case 'excellent': return 'Pin-sharp';
    case 'good':      return 'Tight';
    case 'fair':      return 'Loose';
    case 'poor':      return 'Approximate';
    default:          return 'Unknown';
  }
}

export function formatAccuracy(
  meters?: number | null,
  opts: { showImperial?: boolean } = {},
): string {
  if (meters == null || Number.isNaN(meters) || meters <= 0) return '';
  const m = Math.round(meters);
  if (opts.showImperial) {
    const ft = Math.round(meters * FEET_PER_METER);
    return `~${m} m (${ft} ft)`;
  }
  return `~${m} m`;
}

/** Heuristic: if the draft's state code is a US state, show imperial.
 *  Defaults to imperial because LumaScout is US-first today. */
export function shouldShowImperial(stateCode?: string | null): boolean {
  if (!stateCode) return true;
  const s = stateCode.trim().toUpperCase();
  // Canadian provinces — metric
  const CA = new Set(['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']);
  if (CA.has(s)) return false;
  return true;
}

/** Color name that maps to a token in the theme palette (callers should
 *  map these to colors.{success|warning|secondary|textTertiary}). */
export function accuracyColorKey(tier: AccuracyTier): 'success' | 'warning' | 'secondary' | 'textTertiary' {
  if (tier === 'excellent' || tier === 'good') return 'success';
  if (tier === 'fair') return 'warning';
  if (tier === 'poor') return 'secondary';
  return 'textTertiary';
}
