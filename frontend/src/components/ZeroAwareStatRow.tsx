/**
 * ZeroAwareStatRow — Profile / user-detail stats row that hides
 * zero values behind a short motivational prompt, and collapses
 * entirely to a single "just getting started" card when every
 * stat is zero.
 *
 * Design rules (Jun 2025 design ask):
 *   • No screen should ever display a row of all-zero numbers
 *     simultaneously.
 *   • When SOME stats are zero, the cell hides the "0" and shows
 *     a short, encouraging, sentence-case prompt.
 *   • When ALL stats are zero, the whole row collapses to one
 *     compact card so the screen never reads as empty / broken.
 *
 * Tone rules:
 *   • Sentence case. No uppercase. No exclamation marks.
 *   • Encouraging, never salesy. ("Be the first to follow",
 *     "No views yet — share your profile", "No saves yet")
 *   • Avoid anything that feels negative, empty, or broken.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Share2, Users, Bookmark, Sparkles, ChevronRight, Image as ImageIcon, Compass } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

export type StatKind =
  | 'followers'
  | 'following'
  | 'views'          // profile views (signed-in self view of own profile)
  | 'saves'          // total saves of my work
  | 'spots'
  | 'posts'
  | 'spot_views'     // views of a specific spot
  | 'spot_saves'     // saves of a specific spot
  | 'generic';

export interface StatItem {
  label: string;
  value: number;
  kind: StatKind;
  onPress?: () => void;
  /** Override the default copy used in the zero state. */
  zeroCopy?: string;
  /** Tap target for the zero-state prompt. Defaults to `onPress`. */
  promptOnPress?: () => void;
}

/** Default copy library. Picked from the user-approved tone guide:
 *   - Encouraging, sentence-case, no exclamation marks.
 *   - Owner-perspective on `views` / `saves` (the person whose stats
 *     these are is generally the one being motivated). For viewing
 *     OTHER people's profiles use the `zeroCopy` override on the item
 *     so we don't tell viewers to "share your profile" by mistake.
 */
const ZERO_PROMPTS: Record<StatKind, { copy: string; icon: React.ReactNode }> = {
  followers:  { copy: 'Be the first to follow',                      icon: <Share2 size={11} color={colors.text} /> },
  following:  { copy: 'Find photographers to follow',                icon: <Compass size={11} color={colors.text} /> },
  views:      { copy: 'Share your profile to get discovered',        icon: <Share2 size={11} color={colors.text} /> },
  saves:      { copy: 'No saves yet',                                icon: <Bookmark size={11} color={colors.text} /> },
  spots:      { copy: 'Upload your first spot',                      icon: <Sparkles size={11} color={colors.text} /> },
  posts:      { copy: 'Share your first post',                       icon: <ImageIcon size={11} color={colors.text} /> },
  spot_views: { copy: 'No views yet — share this spot',              icon: <Share2 size={11} color={colors.text} /> },
  spot_saves: { copy: 'No saves yet',                                icon: <Bookmark size={11} color={colors.text} /> },
  generic:    { copy: 'Get started',                                 icon: <Sparkles size={11} color={colors.text} /> },
};

/** Compact number formatter — "1,200" / "12.3k" / "1.2M". */
export function formatStatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

interface RowProps {
  items: StatItem[];
  /** Optional CTA for the all-zero collapsed card. */
  allZeroCtaLabel?: string;
  allZeroCtaOnPress?: () => void;
  /** Title + sub used in the all-zero collapse card. Defaults are
   *  generic enough for any profile context but callers can tailor. */
  allZeroTitle?: string;
  allZeroSubtitle?: string;
  /** Optional container style override (e.g. horizontal margins). */
  style?: any;
}

export function ZeroAwareStatRow({
  items,
  allZeroCtaLabel = 'Get started',
  allZeroCtaOnPress,
  allZeroTitle = "You're just getting started",
  allZeroSubtitle = 'Upload a spot and share your profile — your stats appear here as people discover you.',
  style,
}: RowProps) {
  const allZero = items.every(i => !Number.isFinite(i.value) || i.value === 0);

  if (allZero) {
    return (
      <Pressable
        style={[styles.allZeroCard, style]}
        onPress={allZeroCtaOnPress}
        testID="stats-all-zero"
      >
        <View style={styles.allZeroIcon}>
          <Sparkles size={16} color={colors.primary} />
        </View>
        <View style={styles.allZeroText}>
          <Text style={styles.allZeroTitle}>{allZeroTitle}</Text>
          <Text style={styles.allZeroSub}>{allZeroSubtitle}</Text>
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
    <View style={[styles.row, style]}>
      {items.map((it, idx) => (
        <React.Fragment key={`${it.label}-${idx}`}>
          <ZeroAwareStatCell item={it} />
          {idx < items.length - 1 ? <View style={styles.divider} /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

export function ZeroAwareStatCell({ item }: { item: StatItem }) {
  const isZero = !Number.isFinite(item.value) || item.value === 0;
  const C: any = (item.promptOnPress || item.onPress) ? TouchableOpacity : View;
  const onPress = isZero ? (item.promptOnPress || item.onPress) : item.onPress;

  if (isZero) {
    const prompt = ZERO_PROMPTS[item.kind] || ZERO_PROMPTS.generic;
    const copy = item.zeroCopy || prompt.copy;
    return (
      <C
        onPress={onPress}
        style={styles.cellZero}
        activeOpacity={0.85}
        testID={`stat-zero-${item.kind}`}
      >
        <View style={styles.zeroIconBox}>{prompt.icon}</View>
        <Text style={styles.cellZeroLabel} numberOfLines={3}>{copy}</Text>
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
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'stretch',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginVertical: 6,
  },

  // Non-zero cell
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, paddingHorizontal: 2 },
  cellValue: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 18,
    letterSpacing: -0.3,
  },
  cellLabel: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 10.5,
    marginTop: 2,
  },

  // Zero / prompt cell — shorter, centered, multi-line copy
  cellZero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    gap: 5,
  },
  zeroIconBox: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cellZeroLabel: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 10,
    lineHeight: 12.5,
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
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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

export default ZeroAwareStatRow;
