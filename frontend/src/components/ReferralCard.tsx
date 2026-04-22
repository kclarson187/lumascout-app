/**
 * ReferralCard — compact premium card for Referral Marketplace listings.
 * Shows: title, gig-type badge, urgency chip, city + date, pay range,
 * posted-time, applicant count, poster avatar.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { MapPin, Clock, Users, Zap, DollarSign } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

export type ReferralNeed = {
  need_id: string;
  title: string;
  shoot_type: string;
  gig_type: string;
  city: string;
  state?: string;
  event_date?: string | null;
  duration_hours?: number | null;
  budget_min?: number | null;
  budget_max?: number | null;
  budget_currency?: string;
  notes?: string | null;
  urgency: 'urgent' | 'normal';
  status: string;
  posted_at: string;
  applicant_count: number;
  is_featured?: boolean;
  is_mine?: boolean;
  my_application?: { app_id: string; status: string; thread_id?: string } | null;
  poster?: {
    user_id: string;
    name: string;
    username?: string;
    avatar_url?: string | null;
    city?: string;
    plan?: string;
    verification_status?: string;
  } | null;
};

const GIG_LABELS: Record<string, string> = {
  full_session_referral: 'Full Session',
  second_shooter: '2nd Shooter',
  associate_shooter: 'Associate',
  content_creator: 'Content Creator',
  pet_session: 'Pet Session',
  wedding_support: 'Wedding Support',
  event_coverage: 'Event Coverage',
};

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  open: { bg: 'rgba(34,197,94,0.15)', fg: '#4ade80', label: 'Open' },
  reviewing: { bg: 'rgba(245,166,35,0.18)', fg: '#F5A623', label: 'Reviewing' },
  filled: { bg: 'rgba(107,114,128,0.2)', fg: '#9ca3af', label: 'Filled' },
  closed: { bg: 'rgba(107,114,128,0.2)', fg: '#9ca3af', label: 'Closed' },
  expired: { bg: 'rgba(107,114,128,0.18)', fg: '#9ca3af', label: 'Expired' },
};

function relTime(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const d = Math.max(0, (Date.now() - t) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 7 * 86400) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatBudget(need: ReferralNeed): string | null {
  const { budget_min, budget_max, budget_currency } = need;
  if (!budget_min && !budget_max) return null;
  const sym = (budget_currency || 'USD') === 'USD' ? '$' : (budget_currency || '') + ' ';
  if (budget_min && budget_max) return `${sym}${budget_min}–${sym}${budget_max}`;
  return `${sym}${budget_min || budget_max}`;
}

function formatEventDate(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return null; }
}

export default function ReferralCard({
  need,
  onPress,
  testID,
  compact,
}: {
  need: ReferralNeed;
  onPress: () => void;
  testID?: string;
  compact?: boolean;
}) {
  const status = STATUS_COLORS[need.status] || STATUS_COLORS.open;
  const city = [need.city, need.state].filter(Boolean).join(', ');
  const budget = formatBudget(need);
  const eventDate = formatEventDate(need.event_date);
  const gigLabel = GIG_LABELS[need.gig_type] || need.gig_type;

  return (
    <TouchableOpacity
      style={[styles.card, need.is_featured && styles.cardFeatured, compact && styles.cardCompact]}
      onPress={onPress}
      activeOpacity={0.85}
      testID={testID || `referral-${need.need_id}`}
    >
      {/* Top row: badges */}
      <View style={styles.topRow}>
        <View style={styles.gigPill}>
          <Text style={styles.gigPillTxt} numberOfLines={1}>{gigLabel}</Text>
        </View>
        {need.urgency === 'urgent' ? (
          <View style={styles.urgentPill}>
            <Zap size={10} color={colors.textInverse} />
            <Text style={styles.urgentTxt}>URGENT</Text>
          </View>
        ) : null}
        {need.is_featured ? (
          <View style={styles.featuredPill}>
            <Text style={styles.featuredTxt}>★ FEATURED</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
          <Text style={[styles.statusTxt, { color: status.fg }]}>{status.label}</Text>
        </View>
      </View>

      {/* Title */}
      <Text style={styles.title} numberOfLines={2}>{need.title}</Text>

      {/* Meta row */}
      <View style={styles.metaRow}>
        {city ? (
          <View style={styles.metaItem}>
            <MapPin size={12} color={colors.textTertiary} />
            <Text style={styles.metaTxt}>{city}</Text>
          </View>
        ) : null}
        {eventDate ? (
          <View style={styles.metaItem}>
            <Clock size={12} color={colors.textTertiary} />
            <Text style={styles.metaTxt}>{eventDate}</Text>
          </View>
        ) : null}
        {budget ? (
          <View style={styles.metaItem}>
            <DollarSign size={12} color={colors.primary} />
            <Text style={[styles.metaTxt, { color: colors.primary }]}>{budget}</Text>
          </View>
        ) : null}
      </View>

      {/* Footer row */}
      <View style={styles.footerRow}>
        {need.poster?.avatar_url ? (
          <Image source={{ uri: need.poster.avatar_url }} style={styles.posterAvatar} />
        ) : (
          <View style={[styles.posterAvatar, styles.posterAvatarFallback]} />
        )}
        <Text style={styles.posterName} numberOfLines={1}>{need.poster?.name || 'Photographer'}</Text>
        <View style={{ flex: 1 }} />
        <View style={styles.footerRight}>
          <View style={styles.appCountRow}>
            <Users size={11} color={colors.textSecondary} />
            <Text style={styles.appCountTxt}>
              {need.applicant_count} {need.applicant_count === 1 ? 'applicant' : 'applicants'}
            </Text>
          </View>
          <Text style={styles.postedTxt}>{relTime(need.posted_at)}</Text>
        </View>
      </View>

      {/* my_application footer */}
      {need.my_application ? (
        <View style={styles.myAppFooter}>
          <Text style={[styles.myAppTxt, need.my_application.status === 'accepted' && { color: colors.success }]}>
            {need.my_application.status === 'accepted'
              ? '✓ Your application was accepted'
              : need.my_application.status === 'rejected'
              ? '✗ Not selected this time'
              : '• Your application is pending'}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.sm,
    marginBottom: space.sm,
  },
  cardFeatured: {
    borderColor: colors.primary,
  },
  cardCompact: {
    width: 280,
    marginRight: space.sm,
    marginBottom: 0,
  },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  gigPill: {
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.28)',
  },
  gigPillTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  urgentPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm, backgroundColor: '#ef4444',
  },
  urgentTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6 },
  featuredPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm,
    backgroundColor: colors.primary,
  },
  featuredTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm },
  statusTxt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },

  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15, lineHeight: 20 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },

  footerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingTop: 8,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  posterAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface2 },
  posterAvatarFallback: { backgroundColor: colors.surface2 },
  posterName: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12, maxWidth: 110 },
  footerRight: { alignItems: 'flex-end', gap: 2 },
  appCountRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  appCountTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  postedTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },

  myAppFooter: {
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  myAppTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
});
