/**
 * EmptyState — reusable premium empty-state primitive. Batch #8 (May 2026).
 *
 * Design principles:
 *   • Always an icon, a title, and a short helpful body. Optional CTA.
 *   • Dark LumaScout theme, subtle gold accent on the icon bubble.
 *   • Never feels like "something's broken" — always like "this will fill
 *     up once you do X" (actionable, not apologetic).
 *   • Responsive: stretches to fill its container (parent sets flex:1 /
 *     min-height).
 *   • Accessible: 44–48pt touch targets on the CTA, uses `accessibilityRole`.
 *
 * Use it anywhere a list can be empty.
 *
 * Example:
 *   <EmptyState
 *     icon={<BookmarkIcon size={28} color={colors.primary} />}
 *     title="No saved spots yet"
 *     body="Tap the bookmark icon on any spot to keep it here for your next shoot."
 *     ctaLabel="Explore nearby spots"
 *     onCtaPress={() => router.push('/explore')}
 *   />
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Bookmark } from 'lucide-react-native';
import { colors, radii, space, font } from '../theme';

type Props = {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
  /** Optional testID on the root view for integration tests. */
  testID?: string;
  /** Compact variant — smaller padding, for rail/card contexts. */
  compact?: boolean;
};

export default function EmptyState({
  icon, title, body, ctaLabel, onCtaPress, testID, compact,
}: Props) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]} testID={testID}>
      <View style={[styles.iconBubble, compact && styles.iconBubbleCompact]}>
        {icon ?? <Bookmark size={22} color={colors.primary} strokeWidth={1.5} />}
      </View>
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      {body ? (
        <Text style={[styles.body, compact && styles.bodyCompact]}>{body}</Text>
      ) : null}
      {ctaLabel && onCtaPress ? (
        <TouchableOpacity
          onPress={onCtaPress}
          style={styles.cta}
          accessibilityRole="button"
          testID={testID ? `${testID}-cta` : undefined}
        >
          <Text style={styles.ctaTxt}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: space.xl,
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  wrapCompact: {
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
  },
  iconBubble: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.28)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.xs,
  },
  iconBubbleCompact: { width: 42, height: 42, borderRadius: 21 },
  title: {
    color: colors.text, fontFamily: font.headline,
    fontSize: 17, letterSpacing: 0.2, textAlign: 'center',
  },
  titleCompact: { fontSize: 14 },
  body: {
    color: colors.textSecondary, fontFamily: font.body,
    fontSize: 13, lineHeight: 19, textAlign: 'center',
    maxWidth: 300,
  },
  bodyCompact: { fontSize: 12, lineHeight: 17, maxWidth: 260 },
  cta: {
    marginTop: space.md,
    minHeight: Platform.OS === 'ios' ? 44 : 48,
    paddingHorizontal: space.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTxt: {
    color: colors.textInverse, fontFamily: font.bodyBold,
    fontSize: 13, letterSpacing: 0.3,
  },
});
