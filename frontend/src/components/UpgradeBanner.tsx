/**
 * UpgradeBanner (PRD UX Polish #9 — Contextual monetization).
 *
 * A tasteful inline upsell card that:
 *   - Only renders for free-plan users.
 *   - Can be dismissed; dismissal is remembered per-placement via AsyncStorage
 *     for 7 days so the user isn't nagged constantly.
 *   - Routes to /paywall on tap.
 *
 * Designed to be drop-in at any point in a scrollable screen where context
 * naturally invites the user to upgrade (Home feed header, Saved tab when
 * favourites > N, marketplace peek, etc.).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Crown, X, Check } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import { useAuth } from '../auth';

const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Web-safe key/value storage mirrors the pattern already used in src/api.ts
// so we don't add a new runtime dependency (AsyncStorage is not installed).
async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}
async function storageSet(key: string, value: string) {
  if (Platform.OS === 'web') {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch { /* noop */ }
    return;
  }
  try { await SecureStore.setItemAsync(key, value); } catch { /* noop */ }
}

type Props = {
  /**
   * Unique placement id so the dismissal state is scoped per-surface
   * (e.g. "home", "saved-limit", "marketplace-peek").
   */
  placement: string;
  /** Main headline, e.g. "Unlock the full photographer network". */
  title: string;
  /** Short subline ending with "Pro" or similar call-to-action phrasing. */
  subtitle: string;
  /** Optional bullet list of benefits (shown when there's enough room). */
  perks?: string[];
  /** CTA label (default "Go Pro"). */
  cta?: string;
  /** Plan to route to (default 'pro'). */
  targetPlan?: 'pro' | 'elite';
  /** Override the default compact layout with a fuller one. */
  variant?: 'compact' | 'full';
};

export default function UpgradeBanner({
  placement,
  title,
  subtitle,
  perks,
  cta = 'Go Pro',
  targetPlan = 'pro',
  variant = 'compact',
}: Props) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const storageKey = `upgrade_banner_dismissed_${placement}`;

  useEffect(() => {
    (async () => {
      try {
        const raw = await storageGet(storageKey);
        if (raw) {
          const ts = Number(raw);
          if (!Number.isNaN(ts) && Date.now() - ts < DISMISS_WINDOW_MS) {
            setDismissed(true);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, [storageKey]);

  // Hide unless signed-in AND on free plan. Keeps premium users from seeing
  // promotional chrome that doesn't apply to them (PRD #9 taste rule).
  const plan = (user?.plan || 'free') as string;
  if (!ready || !user || plan !== 'free' || dismissed) return null;

  const dismiss = async () => {
    setDismissed(true);
    try { await storageSet(storageKey, String(Date.now())); } catch { /* swallow */ }
  };

  const onPress = () => router.push(`/paywall?plan=${targetPlan}` as any);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[styles.card, variant === 'full' && styles.cardFull]}
      testID={`upgrade-banner-${placement}`}
    >
      <View style={styles.iconWrap}>
        <Crown size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={variant === 'full' ? 3 : 2}>{subtitle}</Text>
        {variant === 'full' && !!perks?.length && (
          <View style={{ gap: 3, marginTop: 6 }}>
            {perks.slice(0, 3).map((p) => (
              <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Check size={11} color={colors.success} />
                <Text style={styles.perk}>{p}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={styles.ctaPill}>
        <Text style={styles.ctaTxt}>{cta}</Text>
      </View>
      <TouchableOpacity onPress={dismiss} style={styles.dismissBtn} hitSlop={8}>
        <X size={14} color={colors.textTertiary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radii.lg,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: colors.primary,
    position: 'relative',
  },
  cardFull: { paddingVertical: space.lg },
  iconWrap: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.1 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, lineHeight: 15, marginTop: 2 },
  perk: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  ctaPill: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radii.pill, backgroundColor: colors.primary,
  },
  ctaTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 11, letterSpacing: 0.3 },
  dismissBtn: {
    position: 'absolute', top: 6, right: 6, padding: 4,
  },
});
