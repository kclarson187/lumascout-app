/**
 * /app/screenshot/membership.tsx
 * ═══════════════════════════════════════════════════════════════════
 *
 * App Store submission asset — 1:1 (square) membership comparison.
 *
 * Apple requires a square screenshot for certain App Store metadata
 * slots (App Previews, "iPad Marketing", localized hero panels). This
 * route renders the Free / Pro / Elite tier comparison inside a
 * pixel-locked 1080×1080 frame so the marketing team can:
 *   1. Open `/screenshot/membership` in a desktop browser
 *   2. Use the browser's "Capture Node Screenshot" devtool OR
 *      `mcp_screenshot_tool` to export at exactly 1080×1080
 *   3. Upload directly to App Store Connect
 *
 * IMPORTANT — this route is COSMETIC ONLY. It does NOT touch:
 *   • RevenueCat / Apple IAP logic
 *   • Stripe routing
 *   • Backend subscription validation
 *   • Active entitlement checks
 *   • Super admin / comp Elite access
 *   • The real /paywall screen
 *
 * Reusable as a component: <MembershipSquareScreenshot/> below.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Crown, Sparkles, Camera } from 'lucide-react-native';
import { colors, font } from '../../src/theme';

// Locked square size — App Store accepts 1080x1080 / 1200x1200 / 2048x2048.
// We render at 1080×1080 and let the screenshot tool down/upscale as
// needed. CSS transform: scale() in viewport-sized wrappers keeps the
// preview readable in a browser.
const SQ = 1080;

const TIERS = [
  {
    key: 'free',
    name: 'Free',
    price: '',
    priceSub: '',
    tagline: 'Start scouting',
    features: [
      'Save 3 spots',
      'Upload locations',
      'Community access',
      'Current weather',
      'Basic scouting tools',
    ],
    accent: '#9CA3AF',
    badge: null as React.ReactNode | null,
    cardBgColors: ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.02)'] as const,
    borderColor: '#1F1F1F',
    headerColor: colors.text,
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$9.99',
    priceSub: '/mo',
    tagline: 'Plan around light & weather',
    features: [
      'Unlimited saves',
      'Collections',
      'Route planning',
      'Advanced filters',
      '5-day weather',
      'Profile analytics',
      'Pro badge',
    ],
    accent: '#F5A623',
    badge: 'Best for photographers',
    cardBgColors: ['rgba(245,166,35,0.10)', 'rgba(245,166,35,0.02)'] as const,
    borderColor: 'rgba(245,166,35,0.45)',
    headerColor: '#F5A623',
  },
  {
    key: 'elite',
    name: 'Elite',
    price: '$19.99',
    priceSub: '/mo',
    tagline: 'Advanced shoot planning',
    features: [
      'Everything in Pro',
      '10-day weather',
      'Sun path planning',
      'Seasonal insights',
      'Hidden gems',
      'Priority support',
      'Elite badge',
    ],
    accent: '#BB86FC',
    badge: 'Most advanced',
    cardBgColors: ['rgba(187,134,252,0.16)', 'rgba(187,134,252,0.04)'] as const,
    borderColor: 'rgba(187,134,252,0.55)',
    headerColor: '#BB86FC',
  },
];

/**
 * Reusable square component. Renders the membership comparison in a
 * 1080×1080 frame. Safe to embed in any view (admin tooling, etc.).
 */
export function MembershipSquareScreenshot() {
  return (
    <View style={styles.square} testID="membership-square-1080">
      {/* Cinematic gradient backdrop */}
      <LinearGradient
        colors={['#0A0A0A', '#111017', '#0A0A0A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Subtle accent glow top-left */}
      <LinearGradient
        colors={['rgba(245,166,35,0.10)', 'rgba(187,134,252,0.06)', 'transparent']}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.8, y: 0.8 }}
        style={[StyleSheet.absoluteFill, { opacity: 0.9 }]}
      />

      {/* Inner safe-area padding so cards never touch the square edge */}
      <View style={styles.safe}>
        {/* ─── Header ───────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandIconWrap}>
              <Camera size={22} color={colors.primary} />
            </View>
            <Text style={styles.brandWord}>LumaScout</Text>
          </View>
          <Text style={styles.headline}>Membership</Text>
          <Text style={styles.subtitle}>
            Scout better locations. Plan around light and weather. Save and organize shoot spots.
          </Text>
        </View>

        {/* ─── Three cards ──────────────────────────────────────────── */}
        <View style={styles.cardsRow}>
          {TIERS.map((t) => {
            const isPro   = t.key === 'pro';
            const isElite = t.key === 'elite';
            return (
              <View key={t.key} style={[styles.card, { borderColor: t.borderColor }]} testID={`membership-card-${t.key}`}>
                <LinearGradient
                  colors={t.cardBgColors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />

                {/* Tier-rank pill (Pro/Elite only) */}
                {t.badge && (
                  <View style={[styles.tierBadge, { borderColor: t.borderColor, backgroundColor: 'rgba(0,0,0,0.35)' }]}>
                    {isPro && <Crown size={11} color={t.accent} />}
                    {isElite && <Sparkles size={11} color={t.accent} />}
                    <Text style={[styles.tierBadgeText, { color: t.accent }]}>{t.badge}</Text>
                  </View>
                )}

                {/* Tier name */}
                <Text style={[styles.tierName, { color: t.headerColor }]}>{t.name}</Text>

                {/* Price */}
                <View style={styles.priceRow}>
                  {t.price ? (
                    <>
                      <Text style={styles.priceMain}>{t.price}</Text>
                      <Text style={styles.priceSub}>{t.priceSub}</Text>
                    </>
                  ) : (
                    <Text style={styles.priceFree}>$0</Text>
                  )}
                </View>

                {/* Tagline */}
                <Text style={styles.tagline}>{t.tagline}</Text>

                {/* Divider */}
                <View style={[styles.divider, { backgroundColor: t.borderColor }]} />

                {/* Features list */}
                <View style={styles.featureList}>
                  {t.features.map((f) => (
                    <View key={f} style={styles.featureRow}>
                      <View style={[styles.checkBubble, {
                        backgroundColor: isPro || isElite
                          ? `${t.accent}26`
                          : 'rgba(255,255,255,0.06)',
                      }]}>
                        <Check size={12} color={isPro || isElite ? t.accent : '#A1A1AA'} strokeWidth={3} />
                      </View>
                      <Text style={[styles.featureText, (isPro || isElite) && { color: colors.text }]}>{f}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </View>

        {/* ─── Footer line ─────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Text style={styles.footerLine}>
            Unlock advanced shoot planning with Pro or Elite.
          </Text>
          <Text style={styles.footerFine}>
            Manage or cancel anytime. iOS purchases processed by Apple.
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Route entry point — centers the 1080 square on whatever the host
 * screen actually is. The component itself is pixel-locked; this
 * wrapper just provides the dark backdrop and scaling for browser
 * preview ergonomics. The actual capture happens on the inner
 * `testID="membership-square-1080"` element which is always 1080×1080.
 */
export default function MembershipScreenshotRoute() {
  return (
    <View style={styles.pageWrap}>
      <MembershipSquareScreenshot />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────
//
// The `square` block is the pixel-locked 1080×1080 capture surface.
// Everything inside it is sized in absolute pixels so any screenshot
// tool sees the same layout regardless of viewport.
const styles = StyleSheet.create({
  pageWrap: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    minHeight: SQ + 32,
  },
  square: {
    width: SQ,
    height: SQ,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  safe: {
    flex: 1,
    paddingHorizontal: 56,
    paddingTop: 56,
    paddingBottom: 56,
    justifyContent: 'space-between',
  },

  // Header
  header: { gap: 18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.25)',
  },
  brandWord: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  headline: { color: colors.text, fontFamily: font.display, fontSize: 56, lineHeight: 60, letterSpacing: -1.2 },
  subtitle: { color: '#A1A1AA', fontFamily: font.body, fontSize: 18, lineHeight: 26, maxWidth: 880 },

  // Cards row
  cardsRow: {
    flexDirection: 'row',
    gap: 18,
    marginVertical: 8,
    flex: 1,
    alignItems: 'stretch',
  },
  card: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    padding: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.02)',
    ...Platform.select({ web: { backdropFilter: 'blur(8px)' as any }, default: {} }),
  },
  tierBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1,
    marginBottom: 10,
  },
  tierBadgeText: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.3 },
  tierName: {
    fontFamily: font.display, fontSize: 28, letterSpacing: -0.4, marginTop: 4,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4, gap: 4 },
  priceMain: { color: colors.text, fontFamily: font.display, fontSize: 32, letterSpacing: -0.5 },
  priceSub:  { color: '#A1A1AA', fontFamily: font.body, fontSize: 14 },
  priceFree: { color: colors.text, fontFamily: font.display, fontSize: 32, letterSpacing: -0.5 },
  tagline:   { color: '#A1A1AA', fontFamily: font.body, fontSize: 13, marginTop: 6, lineHeight: 18 },
  divider:   { height: 1, marginVertical: 14 },
  featureList: { gap: 9 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  checkBubble: {
    width: 20, height: 20, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  featureText: { color: '#D4D4D8', fontFamily: font.body, fontSize: 13.5, flexShrink: 1, lineHeight: 18 },

  // Footer
  footer: { alignItems: 'center', gap: 6, marginTop: 6 },
  footerLine: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 16, textAlign: 'center' },
  footerFine: { color: '#71717A', fontFamily: font.body, fontSize: 12, textAlign: 'center' },
});
