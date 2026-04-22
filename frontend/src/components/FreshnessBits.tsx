import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Check, Flower, Sunset, Users, Leaf, Dog, Baby, Ban, Construction, CircleParking, TreePine, Droplets, Sparkles } from 'lucide-react-native';
import { colors, font, radii } from '../theme';

/**
 * Shared freshness primitives used by spot detail, home rail, upload /
 * update screens, and moderation queue. Keep the canonical vocabulary
 * here — backend mirrors the same tokens in ALLOWED_CONDITION_TAGS.
 * (Feature 9 — community uploads / freshness)
 */

export const CONDITION_TAGS: Array<{ key: string; label: string; Icon: any; color: string }> = [
  { key: 'verified_today',  label: 'Verified Today',  Icon: Check,         color: colors.success },
  { key: 'blooming',        label: 'Blooming',        Icon: Flower,        color: '#ec4899' },
  { key: 'great_sunset',    label: 'Great Sunset',    Icon: Sunset,        color: '#f59e0b' },
  { key: 'crowded',         label: 'Crowded',         Icon: Users,         color: '#ef4444' },
  { key: 'quiet',           label: 'Quiet',           Icon: Leaf,          color: '#10b981' },
  { key: 'muddy',           label: 'Muddy',           Icon: Droplets,      color: '#92400e' },
  { key: 'dog_friendly',    label: 'Dog Friendly',    Icon: Dog,           color: '#0ea5e9' },
  { key: 'family_friendly', label: 'Family Friendly', Icon: Baby,          color: '#a855f7' },
  { key: 'closed_gate',     label: 'Closed Gate',     Icon: Ban,           color: '#dc2626' },
  { key: 'construction',    label: 'Construction',    Icon: Construction,  color: '#f59e0b' },
  { key: 'good_parking',    label: 'Good Parking',    Icon: CircleParking, color: '#3b82f6' },
  { key: 'fall_colors',     label: 'Fall Colors',     Icon: TreePine,      color: '#d97706' },
];

export const CONDITION_MAP: Record<string, typeof CONDITION_TAGS[number]> = CONDITION_TAGS.reduce(
  (acc, t) => { acc[t.key] = t; return acc; },
  {} as any,
);

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 45) return 'just now';
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Small chip used in compact meta rows (no icon, just the label). */
export function ConditionChip({
  tag, selected = false, onPress, testID,
}: { tag: string; selected?: boolean; onPress?: () => void; testID?: string }) {
  const spec = CONDITION_MAP[tag];
  if (!spec) return null;
  const Icon = spec.Icon;
  const Wrapper: any = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={({ pressed }: any) => [
        styles.chip,
        selected && { backgroundColor: spec.color + '22', borderColor: spec.color },
        pressed && { opacity: 0.8 },
      ]}
      testID={testID}
    >
      <Icon size={11} color={selected ? spec.color : colors.textSecondary} />
      <Text style={[styles.chipTxt, selected && { color: spec.color, fontFamily: font.bodySemibold }]}>{spec.label}</Text>
    </Wrapper>
  );
}

/** Larger activity badge — surfaces on spot detail hero / list rows. */
export function ActivityBadge({
  lastActivityAt, recentUploadCount7d,
}: { lastActivityAt?: string | null; recentUploadCount7d?: number }) {
  if (!lastActivityAt) return null;
  const ageH = (Date.now() - new Date(lastActivityAt).getTime()) / 3600000;
  if (!Number.isFinite(ageH) || ageH > 24 * 14) return null; // hide after 2 weeks
  let label = 'Fresh This Week';
  let kind: 'hot' | 'fresh' | 'recent' = 'fresh';
  if (ageH < 6) { label = 'Updated Today'; kind = 'hot'; }
  else if (ageH < 24) { label = 'Updated Today'; kind = 'hot'; }
  else if (ageH < 24 * 3) { label = 'Fresh This Week'; kind = 'fresh'; }
  else { label = 'Recently Verified'; kind = 'recent'; }
  if ((recentUploadCount7d ?? 0) >= 3) label = 'Trending Again';
  const tone = kind === 'hot' ? { bg: 'rgba(34,197,94,0.14)', fg: colors.success, border: 'rgba(34,197,94,0.4)' }
    : kind === 'fresh' ? { bg: 'rgba(245,166,35,0.14)', fg: colors.primary, border: 'rgba(245,166,35,0.4)' }
    : { bg: 'rgba(59,130,246,0.14)', fg: '#3b82f6', border: 'rgba(59,130,246,0.4)' };
  const Icon = kind === 'hot' ? Sparkles : Check;
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]} testID="freshness-badge">
      <Icon size={11} color={tone.fg} />
      <Text style={[styles.badgeTxt, { color: tone.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  badgeTxt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
});
