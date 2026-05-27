/**
 * ZeroAwareStatRow — Profile / user-detail stats row that hides
 * zero values behind a motivational prompt, and collapses entirely
 * to a single "just getting started" empty state when every stat
 * is zero.
 *
 * The goal (per May 2026 design ask):
 *   • No screen should ever display a row of all-zero numbers
 *     simultaneously.
 *   • When SOME stats are zero, replace the "0" with a short
 *     motivational prompt — e.g. "0 Views" → "Share your profile
 *     to get views" with a share icon.
 *   • When ALL stats are zero, replace the whole row with one
 *     compact "Just getting started" card so the screen doesn't
 *     feel like an empty grid.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Share2, Users, Eye, Bookmark, Sparkles, ChevronRight } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

export type StatKind = 'followers' | 'following' | 'views' | 'saves' | 'spots' | 'generic';

export interface StatItem {
  label: string;
  value: number;
  kind: StatKind;
  onPress?: () => void;
  /** Tap target for the zero-state prompt. Defaults to `onPress`. */
  promptOnPress?: () => void;
}

/** Copy library for the zero-state prompt per stat kind. Kept here
 * so it can be tweaked / localised independently of the layout. */
const ZERO_PROMPTS: Record<StatKind, { copy: string; icon: React.ReactNode }> = {
  followers: { copy: 'Share your profile to get followers',  icon: <Share2 size={12} color={colors.text} /> },
  following: { copy: 'Find photographers to follow',         icon: <Users  size={12} color={colors.text} /> },
  views:     { copy: 'Share your profile to get views',      icon: <Share2 size={12} color={colors.text} /> },
  saves:     { copy: 'Upload spots to earn saves',           icon: <Bookmark size={12} color={colors.text} /> },
  spots:     { copy: 'Upload your first spot',               icon: <Sparkles size={12} color={colors.text} /> },
  generic:   { copy: 'Get started',                          icon: <Sparkles size={12} color={colors.text} /> },
};

/** Compact number formatter — "1,200" / "12.3k" / "1.2M". Identical
 * output for sub-1000 to keep the dense feel; switches to k/M above. */
export function formatStatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

interface RowProps {
  items: StatItem[];
  /** Tapped when the whole row collapses to "just getting started". */
  allZeroCtaLabel?: string;
  allZeroCtaOnPress?: () => void;
}

/** Full row with adaptive empty-state handling. */
export function ZeroAwareStatRow({
  items,
  allZeroCtaLabel = 'Get started',
  allZeroCtaOnPress,
}: RowProps) {
  const allZero = items.every(i => !Number.isFinite(i.value) || i.value === 0);
  if (allZero) {
    return (
      <Pressable
        style={styles.allZeroCard}
        onPress={allZeroCtaOnPress}
        testID="stats-all-zero"
      >
        <View style={styles.allZeroIcon}>
          <Sparkles size={16} color={colors.primary} />
        </View>
        <View style={styles.allZeroText}>
          <Text style={styles.allZeroTitle}>You&apos;re just getting started</Text>
          <Text style={styles.allZeroSub}>Upload a spot and share your profile — your stats appear here as people discover you.</Text>
        </View>
        {allZeroCtaOnPress ? (
          <View style={styles.allZeroCta}>
            <Text style={styles.allZeroCtaText}>{allZeroCtaLabel}</Text>
            <ChevronRight size={14} color={colors.text} />
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View style={styles.row}>
      {items.map((it, idx) => (
        <React.Fragment key={it.label}>
          <ZeroAwareStatCell item={it} />
          {idx < items.length - 1 ? <View style={styles.divider} /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

/** Single cell. Shows the number normally, or a motivational micro-
 * prompt when value=0. The prompt is intentionally shorter than the
 * normal label so the cell heights match across mixed rows. */
export function ZeroAwareStatCell({ item }: { item: StatItem }) {
  const isZero = !Number.isFinite(item.value) || item.value === 0;
  const C: any = (item.promptOnPress || item.onPress) ? TouchableOpacity : View;
  const onPress = isZero ? (item.promptOnPress || item.onPress) : item.onPress;

  if (isZero) {
    const prompt = ZERO_PROMPTS[item.kind] || ZERO_PROMPTS.generic;
    return (
      <C
        onPress={onPress}
        style={styles.cellZero}
        activeOpacity={0.85}
        testID={`stat-zero-${item.kind}`}
      >
        <View style={styles.zeroIconBox}>{prompt.icon}</View>
        <Text style={styles.cellZeroLabel} numberOfLines={2}>{prompt.copy}</Text>
      </C>
    );
  }

  return (
    <C
      onPress={onPress}
      style={styles.cell}
      activeOpacity={0.85}
      testID={`stat-${item.kind}`}
    >
      <Text
        style={styles.cellValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {formatStatNumber(item.value)}
      </Text>
      <Text style={styles.cellLabel} numberOfLines={1}>{item.label}</Text>
    </C>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
  },
  divider: {
    width: 1,
    backgroundColor: colors.border,
    marginVertical: 6,
  },

  // Non-zero cell
  cell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  cellValue: {
    color: colors.text,
    fontFamily: font.displayBold,
    fontSize: 20,
  },
  cellLabel: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 11,
    marginTop: 2,
  },

  // Zero / prompt cell — shorter, centered
  cellZero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 4,
  },
  zeroIconBox: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.surface3,
    alignItems: 'center', justifyContent: 'center',
  },
  cellZeroLabel: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 10.5,
    lineHeight: 13,
    textAlign: 'center',
  },

  // All-zero collapse card
  allZeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    paddingVertical: space.lg,
    paddingHorizontal: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  allZeroIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  allZeroText: { flex: 1 },
  allZeroTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  allZeroSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
  allZeroCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  allZeroCtaText: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
});
