/**
 * AchievementsSection — Profile "Achievements" section (Jun 2025).
 *
 * Purpose
 *  • Removes badge clutter from the profile header. The earned badges
 *    (Verified, Pro, Elite, Founding Scout, Moderator, etc.) now live
 *    in their own dedicated section lower on the page where they read
 *    as a meaningful trophy case, not header noise.
 *
 * Rules
 *  • PURELY presentational. Reads from the existing `user` payload —
 *    we never assign new badges or change role/subscription gating.
 *  • Tasteful empty state when nothing is earned yet — the section
 *    never shouts "you have no achievements", it invites contribution.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  ShieldCheck,
  Crown,
  Sparkles,
  ShieldAlert,
  Award,
  Star,
  Flame,
} from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';

interface Achievement {
  key: string;
  label: string;
  sub: string;
  Icon: any;
  tone: 'gold' | 'verify' | 'role' | 'fresh';
}

interface Props {
  user: any;
}

export default function AchievementsSection({ user }: Props) {
  const list = buildAchievements(user);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Award size={14} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Achievements</Text>
          <Text style={styles.title}>Badges earned</Text>
        </View>
      </View>

      {list.length === 0 ? (
        <View style={styles.emptyBox}>
          <View style={styles.emptyIcon}>
            <Sparkles size={16} color={colors.textTertiary} />
          </View>
          <Text style={styles.emptyTitle}>Earn your first badge</Text>
          <Text style={styles.emptySub}>
            Verify your account, contribute spots, and grow your community to start collecting achievements.
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {list.map((a) => (
            <AchievementChip key={a.key} item={a} />
          ))}
        </View>
      )}
    </View>
  );
}

function AchievementChip({ item }: { item: Achievement }) {
  const palette =
    item.tone === 'gold'   ? { border: 'rgba(245,166,35,0.45)', bg: 'rgba(245,166,35,0.12)', fg: colors.primary } :
    item.tone === 'verify' ? { border: 'rgba(96,165,250,0.45)', bg: 'rgba(96,165,250,0.12)', fg: colors.info } :
    item.tone === 'role'   ? { border: 'rgba(167,139,250,0.45)', bg: 'rgba(167,139,250,0.12)', fg: '#A78BFA' } :
                              { border: 'rgba(16,185,129,0.45)', bg: 'rgba(16,185,129,0.12)', fg: colors.success };

  return (
    <View style={[styles.chip, { borderColor: palette.border, backgroundColor: palette.bg }]} testID={`achievement-${item.key}`}>
      <View style={[styles.chipIcon, { backgroundColor: palette.bg, borderColor: palette.border }]}>
        <item.Icon size={14} color={palette.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.chipLabel, { color: palette.fg }]} numberOfLines={1}>{item.label}</Text>
        <Text style={styles.chipSub} numberOfLines={2}>{item.sub}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Earned-badge derivation (read-only from existing user payload)
// ─────────────────────────────────────────────────────────────────────

function buildAchievements(user: any): Achievement[] {
  if (!user) return [];
  const out: Achievement[] = [];

  // Verified (gold-tier trust)
  if ((user.verification_status || '').toLowerCase() === 'verified') {
    out.push({
      key: 'verified',
      label: 'Verified',
      sub: 'Identity confirmed by LumaScout',
      Icon: ShieldCheck,
      tone: 'verify',
    });
  }

  // Subscription tier badges — keep existing role hierarchy. We only
  // surface badges the user already has; we don't grant anything new.
  const plan = (user.plan || user.subscription_plan || '').toLowerCase();
  if (plan === 'elite' || user.is_elite === true) {
    out.push({
      key: 'elite',
      label: 'Elite member',
      sub: 'Top-tier subscriber',
      Icon: Crown,
      tone: 'gold',
    });
  } else if (plan === 'pro' || user.is_pro === true) {
    out.push({
      key: 'pro',
      label: 'Pro member',
      sub: 'Premium subscriber',
      Icon: Star,
      tone: 'gold',
    });
  }

  // Founding Scout — surfaced from either an explicit flag or one of
  // the legacy boolean fields the backend has used in past seeds.
  if (user.is_founding_scout === true || user.founding_scout === true) {
    out.push({
      key: 'founding_scout',
      label: 'Founding Scout',
      sub: 'Early supporter of LumaScout',
      Icon: Flame,
      tone: 'gold',
    });
  }

  // Staff roles
  const role = (user.role || '').toLowerCase();
  if (role === 'moderator' || role === 'super_admin' || role === 'admin') {
    out.push({
      key: 'moderator',
      label: role === 'moderator' ? 'Community moderator' : 'Staff',
      sub: 'Keeps the community healthy',
      Icon: ShieldAlert,
      tone: 'role',
    });
  }

  // Contributor / reputation tiers — based on existing stats. We use
  // very conservative thresholds so the tile only shows up once it's
  // genuinely earned.
  const spotsCount = Number(user.spots_created ?? user.spots_count ?? 0);
  if (spotsCount >= 25) {
    out.push({
      key: 'top_contributor',
      label: 'Top contributor',
      sub: `${spotsCount} spots scouted`,
      Icon: Sparkles,
      tone: 'fresh',
    });
  } else if (spotsCount >= 10) {
    out.push({
      key: 'rising_contributor',
      label: 'Rising contributor',
      sub: `${spotsCount} spots scouted`,
      Icon: Sparkles,
      tone: 'fresh',
    });
  } else if (spotsCount >= 1) {
    out.push({
      key: 'first_spot',
      label: 'First spot',
      sub: 'Your first contribution is live',
      Icon: Sparkles,
      tone: 'fresh',
    });
  }

  return out;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.xl,
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  kicker: {
    color: colors.kicker,
    fontFamily: font.bodySemibold,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 18,
    letterSpacing: -0.2,
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    width: '48%',
  },
  chipIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  chipLabel: {
    fontFamily: font.bodySemibold,
    fontSize: 12.5,
  },
  chipSub: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 10.5,
    marginTop: 1,
    lineHeight: 13,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  emptyIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 13,
    marginTop: 4,
  },
  emptySub: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 18,
    lineHeight: 16,
  },
});
