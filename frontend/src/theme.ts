/**
 * LumaScout design tokens — May 2026 premium-polish revision.
 *
 * GOALS (per design refresh ask):
 *  1. Editorial serif (Playfair Display) for display + body sans (Inter)
 *  2. Restrict gold/amber accent to: primary-CTA backgrounds, Pro/Elite
 *     tier badges, premium map pins. Everything else uses white / muted
 *     gray / subdued tones.
 *  3. Consistent dark-theme elevation system:
 *       bg        = #0A0A0A (page base)
 *       surface1  = #141414 (cards / sheet bg)
 *       surface2  = #1E1E1E (raised elements / inputs)
 *       surface3  = #262626 (hover / pressed / micro-controls)
 *  4. Sentence-case labels — no uppercase kickers. Use `kicker` token
 *     (= muted gray, no letter-spacing) for section labels.
 */
export const colors = {
  // Base elevation system
  bg: '#0A0A0A',
  surface1: '#141414',
  surface2: '#1E1E1E',
  surface3: '#262626',
  overlay: 'rgba(10,10,10,0.6)',
  border: '#2A2A2A',
  borderSubtle: '#1E1E1E',

  // Gold accent — RESTRICTED USE.
  //   • primary  : the only color allowed on primary-CTA backgrounds.
  //   • accent   : alias of primary for explicit "premium-only" surfaces
  //                (Pro/Elite tier badges, premium map pin). Same hex,
  //                separate token so a future re-color won't accidentally
  //                affect CTAs.
  // NEVER use these on section labels, kickers, chips, follow stats, or
  // generic "highlight" elements — use `kicker` or `text` instead.
  primary: '#F5A623',
  primaryDark: '#D48B1B',
  accent: '#F5A623',

  // Action colors
  secondary: '#D04848',
  success: '#10B981',
  warning: '#FBBF24',
  info: '#60A5FA',

  // Text scale
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#71717A',
  textInverse: '#000000',

  // Section labels / kickers / chips that previously used gold. ALL
  // such labels now resolve to this token so the editorial palette
  // stays consistent. Sentence case, no letter-spacing.
  kicker: '#A1A1AA',

  // Map pins (the gold premium pin keeps the brand color)
  pinPublic: '#FFFFFF',
  pinPremium: '#F5A623',
  pinSaved: '#60A5FA',
  pinVerified: '#10B981',
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
};

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
};

/**
 * Typography tokens.
 *
 * Display = Playfair Display (editorial serif, photo-magazine feel).
 * Body    = Inter (clean geometric sans, replaces Manrope May 2026).
 *
 * NOTE: the body* family aliases are kept so existing screens that
 * reference `font.body` / `font.bodyBold` / `font.bodyMedium` /
 * `font.bodySemibold` keep working without a global rename. Each now
 * resolves to the corresponding Inter weight.
 */
export const font = {
  display: 'PlayfairDisplay_700Bold',
  // Alias for any code path that referenced font.displayBold (pre-2026
  // typo that silently fell back to the system font). Kept as an alias
  // so we don't have to chase 2 callsites this round.
  displayBold: 'PlayfairDisplay_700Bold',
  displayItalic: 'PlayfairDisplay_600SemiBold_Italic',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
};

import { Platform } from 'react-native';

// Cross-platform shadow: uses native shadow* props on iOS/Android and the
// modern boxShadow string on web (to silence deprecation warnings).
export const shadow = {
  card: Platform.select({
    web: {
      boxShadow: '0 8px 16px rgba(0,0,0,0.45)',
    },
    default: {
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
  }) as any,
};

export const SHOOT_TYPES = [
  'Family', 'Pet', 'Wedding', 'Portrait', 'Seniors', 'Branding', 'Nature', 'Urban',
];

export const QUICK_FILTERS = [
  'Family', 'Pet', 'Wedding', 'Urban', 'Nature', 'Sunset', 'Indoor', 'Dog Friendly',
];

export const BEST_TIMES = [
  { key: 'sunrise', label: 'Sunrise' },
  { key: 'morning', label: 'Morning' },
  { key: 'golden_hour', label: 'Golden Hour' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'sunset', label: 'Sunset' },
  { key: 'evening', label: 'Evening' },
];

export const PRIVACY_MODES = [
  { key: 'public', label: 'Public', help: 'Visible on the map to everyone. Goes through quick review.' },
  { key: 'followers', label: 'Followers', help: 'Only people who follow you can see this spot.' },
  { key: 'private', label: 'Private', help: 'Just for you. Never shared.' },
  // (Apr 2026) Removed "Premium - requires subscription to view" — direct
  // user feedback: the option created confusion and was never actually
  // shipping a paywall on individual spots. Marketplace handles paid content.
];
