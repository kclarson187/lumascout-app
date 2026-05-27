/**
 * ProfileCompletionCard — Phase 2.1 (Jun 2025).
 *
 * Soft re-engagement card shown on the Profile tab when the signed-in
 * user has not yet completed every step required for photographer-
 * directory visibility. Surfaces:
 *   • completion percent (server-computed)
 *   • next action label
 *   • CTA → deep-link into the corresponding step
 *
 * Hides itself completely when completion === 100 OR when the missing
 * list is empty (user is already directory-eligible). Never blocks
 * the user — it is intentionally collapsible / dismissable.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Sparkles, ChevronRight, Check } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import { labelForMissing, type DirectoryStatus } from '../utils/profileCompletion';

type Props = {
  /** From /auth/me — server-computed. */
  percent?: number | null;
  /** From /auth/me — server-computed. */
  missing?: DirectoryStatus['missing'];
  /** Optional override route; defaults to /onboarding/photographer. */
  ctaRoute?: string;
};

export function ProfileCompletionCard({ percent, missing, ctaRoute }: Props) {
  const pct = Math.max(0, Math.min(100, percent ?? 0));
  const items = missing || [];
  // Render nothing once they're done. Card is opt-out by being complete.
  if (pct >= 100 || items.length === 0) return null;

  const nextStep = items[0];
  const nextLabel = labelForMissing(nextStep);
  const route = ctaRoute || '/onboarding/photographer';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(route as any)}
      activeOpacity={0.85}
      testID="profile-completion-card"
    >
      <View style={styles.head}>
        <View style={styles.iconBox}>
          <Sparkles size={14} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Finish your photographer profile</Text>
          <Text style={styles.sub}>{pct}% complete · {items.length} step{items.length === 1 ? '' : 's'} left</Text>
        </View>
        <ChevronRight size={16} color={colors.textTertiary} />
      </View>

      {/* Progress bar */}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>

      {/* Up to 3 most-relevant missing items */}
      <View style={{ gap: 6, marginTop: 10 }}>
        {items.slice(0, 3).map((k) => (
          <View key={k} style={styles.row}>
            <View style={styles.dot} />
            <Text style={styles.rowTxt} numberOfLines={1}>{labelForMissing(k)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.cta}>
        <Text style={styles.ctaTxt}>Continue setup ›</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.xl, marginTop: space.lg,
    padding: space.md,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.25)',
    borderRadius: radii.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  sub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 1 },

  barTrack: {
    height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginTop: 10, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.primary },

  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: colors.textTertiary },
  rowTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, flex: 1 },

  cta: { marginTop: 10, alignSelf: 'flex-start' },
  ctaTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11 } });

export default ProfileCompletionCard;
