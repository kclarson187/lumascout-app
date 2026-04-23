/**
 * LumaScout Settings Hub — premium dark mode Settings / Creator Tools / Support / Legal
 * Scope: Account · Creator Tools · Field Tools · Support · Legal · About · Staff Tools
 * Design: Apple Settings + Instagram Creator Tools + Pro Camera App
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  Linking, Platform, RefreshControl, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import {
  ChevronLeft, ChevronRight, Crown, User, Bell, CreditCard, Bookmark,
  PackageOpen, Store, Briefcase, Users, Eye, MessageSquareText,
  GraduationCap, MapPin, Camera, Compass, HelpCircle, LifeBuoy,
  Flag, UserX, Lightbulb, Shield, FileText, Gavel, ScrollText,
  RotateCcw, Trash2, Info, Sparkles, Star, AtSign, Settings as Cog,
  ArrowUpRight, Lock, ShieldCheck, ChevronsRight, Zap,
} from 'lucide-react-native';
import { useAuth } from '../src/auth';
import { api } from '../src/api';
import { colors, font, space, radii } from '../src/theme';

// ──────────────────────────────────────────────────────────────────────────────
// Types + helpers
// ──────────────────────────────────────────────────────────────────────────────
type Plan = 'free' | 'pro' | 'elite';
const PRIVACY_URL = 'https://lumascout.app/privacy';
const TERMS_URL = 'https://lumascout.app/terms';
const SELLER_TERMS_URL = 'https://lumascout.app/marketplace-terms';
const COMMUNITY_URL = 'https://lumascout.app/community-guidelines';
const REFUND_URL = 'https://lumascout.app/refund-policy';
const INSTAGRAM_URL = 'https://instagram.com/lumascout';
const STORE_URL = Platform.select({
  ios: 'https://apps.apple.com/app/lumascout',
  android: 'https://play.google.com/store/apps/details?id=com.lumascout.app',
  default: 'https://lumascout.app',
});

const STAFF_ROLES = ['admin', 'super_admin', 'moderator'];

type RowBadge = { kind: 'pro' | 'elite' | 'new' | 'locked'; label: string };
type RowSpec = {
  key: string;
  icon: React.ComponentType<any>;
  title: string;
  subtitle?: string;
  onPress: () => void;
  badge?: RowBadge;
  destructive?: boolean;
};

function planLabel(p: string | undefined): string {
  return (p || 'free').charAt(0).toUpperCase() + (p || 'free').slice(1);
}
function comingSoon(feature: string) {
  Alert.alert(feature, 'Coming soon in a future release. We’re polishing this for App Store.');
}
async function openUrl(url: string) {
  try {
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
    else Alert.alert('Could not open', url);
  } catch {
    Alert.alert('Could not open', url);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Screen
// ──────────────────────────────────────────────────────────────────────────────
export default function SettingsHub() {
  const { user, logout, refresh } = useAuth() as any;
  const [stats, setStats] = useState<{ saved: number; followers: number; views_7d: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const plan: Plan = ((user?.plan as Plan) || 'free');
  const isStaff = STAFF_ROLES.includes(user?.role || '');

  const loadStats = useCallback(async () => {
    try {
      const [dash, viewers] = await Promise.all([
        api.get('/me/dashboard').catch(() => ({ data: {} })),
        api.get('/me/viewers/summary').catch(() => ({ data: { count_7d: 0 } })),
      ]);
      const d = dash.data || {};
      setStats({
        saved: Number(d.saves_count ?? d.saved_count ?? user?.saved_count ?? 0),
        followers: Number(d.followers_count ?? user?.followers_count ?? 0),
        views_7d: Number(viewers.data?.count_7d ?? 0),
      });
    } catch {}
  }, [user]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refresh?.(); await loadStats(); } finally { setRefreshing(false); }
  };

  if (!user) return null;
  const appVersion = (Constants.expoConfig as any)?.version || '1.0.0';
  const buildNumber = Platform.OS === 'ios'
    ? (Constants.expoConfig as any)?.ios?.buildNumber
    : (Constants.expoConfig as any)?.android?.versionCode;

  // ────────────────────────────────────────────────────────────────────────
  // SECTIONS
  // ────────────────────────────────────────────────────────────────────────
  const account: RowSpec[] = [
    {
      key: 'profile', icon: User,
      title: 'Profile',
      subtitle: 'Name, bio, photo, specialties, socials',
      onPress: () => router.push('/(tabs)/profile'),
    },
    {
      key: 'membership', icon: CreditCard,
      title: 'Membership',
      subtitle: `${planLabel(plan)} · Tap to manage, upgrade, or view history`,
      onPress: () => router.push('/billing'),
    },
    {
      key: 'notifications', icon: Bell,
      title: 'Notifications',
      subtitle: 'Push, quiet hours, category alerts',
      onPress: () => router.push('/settings/notifications'),
    },
    {
      key: 'saved-data', icon: Bookmark,
      title: 'Saved data',
      subtitle: 'Spots · Collections · Downloads',
      onPress: () => router.push('/(tabs)/saved'),
    },
  ];

  const creatorTools: RowSpec[] = [
    {
      key: 'seller', icon: Store,
      title: 'Marketplace dashboard',
      subtitle: 'Products, earnings, Stripe payouts',
      onPress: () => router.push('/me/seller'),
      badge: plan === 'elite' ? undefined : { kind: 'elite', label: 'Elite' },
    },
    {
      key: 'packs', icon: PackageOpen,
      title: 'Creator packs',
      subtitle: plan === 'elite' ? 'Create + manage premium spot packs' : 'Elite unlocks pack creation',
      onPress: () => router.push('/creator/packs'),
      badge: plan === 'elite' ? undefined : { kind: 'locked', label: 'Elite' },
    },
    {
      key: 'referrals', icon: Briefcase,
      title: 'Referral marketplace',
      subtitle: 'Posted jobs, applications, collaborations',
      onPress: () => router.push('/me-referrals'),
    },
    {
      key: 'network', icon: Users,
      title: 'Photographer network',
      subtitle: 'Followers · Following · Message requests',
      onPress: () => router.push('/(tabs)/network'),
    },
    {
      key: 'viewers', icon: Eye,
      title: 'Who viewed you',
      subtitle: plan === 'free' ? 'Pro unlocks viewer analytics' : 'See who checked your profile',
      onPress: () => router.push('/profile-viewers'),
      badge: plan === 'free' ? { kind: 'pro', label: 'Pro' } : undefined,
    },
    {
      key: 'mentors', icon: GraduationCap,
      title: 'Mentorship',
      subtitle: 'Find a mentor · Become a mentor',
      onPress: () => router.push('/mentors'),
      badge: { kind: 'new', label: 'New' },
    },
  ];

  const fieldTools: RowSpec[] = [
    {
      key: 'location', icon: MapPin,
      title: 'Location preferences',
      subtitle: 'Map app · Units · GPS metadata · Sunrise alerts',
      onPress: () => comingSoon('Location preferences'),
    },
    {
      key: 'camera', icon: Camera,
      title: 'Camera & gear',
      subtitle: 'Brand, gear tags, RAW workflow',
      onPress: () => comingSoon('Camera workflow'),
    },
    {
      key: 'explore', icon: Compass,
      title: 'Travel & explore',
      subtitle: 'Home city · Discovery radius · Seasonal alerts',
      onPress: () => comingSoon('Travel & explore'),
    },
  ];

  const support: RowSpec[] = [
    {
      key: 'help', icon: HelpCircle,
      title: 'Help center',
      subtitle: 'FAQs for photographers',
      onPress: () => openUrl('https://help.lumascout.app'),
    },
    {
      key: 'contact', icon: LifeBuoy,
      title: 'Contact support',
      subtitle: 'Reach the team in-app',
      onPress: () => openUrl('mailto:support@lumascout.app?subject=LumaScout%20Support'),
    },
    {
      key: 'report-spot', icon: Flag,
      title: 'Report a bad spot',
      subtitle: 'Wrong location · closed · unsafe · duplicate',
      onPress: () => comingSoon('Report a bad spot'),
    },
    {
      key: 'report-user', icon: UserX,
      title: 'Report a user',
      subtitle: 'Spam · harassment · fake content',
      onPress: () => comingSoon('Report a user'),
    },
    {
      key: 'feature', icon: Lightbulb,
      title: 'Feature request',
      subtitle: 'Tell us what to build next',
      onPress: () => openUrl('mailto:feedback@lumascout.app?subject=LumaScout%20Feature%20Request'),
    },
  ];

  const legal: RowSpec[] = [
    { key: 'privacy', icon: Shield, title: 'Privacy policy', onPress: () => openUrl(PRIVACY_URL) },
    { key: 'terms', icon: FileText, title: 'Terms of use', onPress: () => openUrl(TERMS_URL) },
    { key: 'seller-terms', icon: Gavel, title: 'Marketplace seller terms', onPress: () => openUrl(SELLER_TERMS_URL) },
    { key: 'community', icon: ScrollText, title: 'Community guidelines', onPress: () => openUrl(COMMUNITY_URL) },
    { key: 'refund', icon: RotateCcw, title: 'Refund policy', onPress: () => openUrl(REFUND_URL) },
    {
      key: 'delete', icon: Trash2, title: 'Delete account',
      subtitle: 'Permanently delete your data',
      onPress: () => Alert.alert(
        'Delete account',
        'This cannot be undone. All spots, packs, saves, messages, and purchases will be removed. Are you sure?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Contact us to proceed', onPress: () => openUrl('mailto:support@lumascout.app?subject=Delete%20my%20LumaScout%20account') },
        ],
      ),
      destructive: true,
    },
  ];

  const about: RowSpec[] = [
    {
      key: 'about', icon: Info,
      title: 'About LumaScout',
      subtitle: 'Our mission + the team',
      onPress: () => openUrl('https://lumascout.app/about'),
    },
    {
      key: 'version', icon: Sparkles,
      title: 'Version',
      subtitle: `v${appVersion}${buildNumber ? ` (${buildNumber})` : ''}`,
      onPress: () => {},
    },
    {
      key: 'whats-new', icon: Zap,
      title: "What's new",
      subtitle: 'Release notes and what changed',
      onPress: () => openUrl('https://lumascout.app/changelog'),
    },
    {
      key: 'rate', icon: Star,
      title: 'Rate the app',
      subtitle: 'Love it? Leave a review',
      onPress: () => openUrl(STORE_URL!),
    },
    {
      key: 'instagram', icon: AtSign,
      title: 'Follow on Instagram',
      subtitle: '@lumascout',
      onPress: () => openUrl(INSTAGRAM_URL),
    },
  ];

  const staffTools: RowSpec[] = isStaff ? [
    {
      key: 'admin-dash', icon: ShieldCheck,
      title: 'Admin dashboard',
      subtitle: 'Moderation, approvals, reports, flags',
      onPress: () => router.push('/admin'),
    },
  ] : [];

  // Stat header values
  const miniStats = [
    { label: 'Saved', value: stats?.saved ?? 0 },
    { label: 'Followers', value: stats?.followers ?? 0 },
    { label: 'Views / 7d', value: stats?.views_7d ?? 0 },
    { label: 'Plan', value: planLabel(plan), isPlan: true },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="settings-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Manage your account, gear, privacy, and creator tools.</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Profile / Stats header */}
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.heroAvatar} />
            ) : (
              <View style={styles.heroAvatar}>
                <User size={22} color={colors.textSecondary} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: space.md }}>
              <Text style={styles.heroName} numberOfLines={1}>{user?.name || user?.username || 'You'}</Text>
              <Text style={styles.heroHandle} numberOfLines={1}>
                {user?.username ? `@${user.username}` : user?.email}
                {user?.city ? ` · ${user.city}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={styles.heroEdit} testID="settings-profile-edit">
              <Cog size={14} color={colors.text} />
              <Text style={styles.heroEditTxt}>Edit</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.statsRow}>
            {miniStats.map((s) => (
              <View key={s.label} style={styles.statCell}>
                <Text style={[styles.statValue, s.isPlan && { color: plan === 'elite' ? colors.primary : plan === 'pro' ? '#7BC47F' : colors.text }]} numberOfLines={1}>
                  {String(s.value)}
                </Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Upgrade CTA (conditional) */}
        {plan !== 'elite' && (
          <TouchableOpacity style={styles.upsell} onPress={() => router.push('/paywall')} testID="settings-upsell">
            <View style={styles.upsellIconWrap}>
              <Crown size={22} color={colors.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.upsellTitle}>
                {plan === 'pro' ? 'Go Elite' : 'Upgrade to Pro'}
              </Text>
              <Text style={styles.upsellBody}>
                {plan === 'pro'
                  ? 'Analytics, priority visibility, featured creator badge.'
                  : 'Unlimited saves, advanced filters, and creator tools.'}
              </Text>
            </View>
            <ArrowUpRight size={18} color={colors.textInverse} />
          </TouchableOpacity>
        )}

        {/* Grouped sections */}
        <Section title="Account" rows={account} />
        <Section title="Creator tools" rows={creatorTools} />
        <Section title="Field tools" rows={fieldTools} />
        <Section title="Support" rows={support} />
        <Section title="Legal" rows={legal} />
        <Section title="About" rows={about} />
        {isStaff && <Section title="Staff tools" rows={staffTools} />}

        {/* Sign out */}
        <TouchableOpacity
          style={styles.signOut}
          onPress={() => Alert.alert(
            'Sign out?',
            'You can sign back in any time with your email.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: async () => { try { await logout(); } catch {} } },
            ],
          )}
          testID="settings-signout"
        >
          <Text style={styles.signOutTxt}>Sign out</Text>
        </TouchableOpacity>

        <Text style={styles.foot}>LumaScout · crafted for photographers</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Section + Row
// ──────────────────────────────────────────────────────────────────────────────
function Section({ title, rows }: { title: string; rows: RowSpec[] }) {
  if (!rows.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {rows.map((row, idx) => (
          <Row key={row.key} row={row} last={idx === rows.length - 1} />
        ))}
      </View>
    </View>
  );
}

function Row({ row, last }: { row: RowSpec; last: boolean }) {
  const Icon = row.icon;
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={row.onPress}
      style={[styles.row, !last && styles.rowDivider]}
      testID={`settings-row-${row.key}`}
    >
      <View style={[styles.iconBox, row.destructive && styles.iconBoxDestructive]}>
        <Icon size={17} color={row.destructive ? '#FF5F56' : colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, row.destructive && { color: '#FF5F56' }]} numberOfLines={1}>
          {row.title}
        </Text>
        {row.subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>{row.subtitle}</Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        {row.badge ? <Badge {...row.badge} /> : null}
        <ChevronRight size={15} color={colors.textTertiary} />
      </View>
    </TouchableOpacity>
  );
}

function Badge({ kind, label }: RowBadge) {
  if (kind === 'locked') {
    return (
      <View style={[styles.badge, styles.badgeLocked]}>
        <Lock size={10} color={colors.primary} />
        <Text style={styles.badgeTxtLocked}>{label}</Text>
      </View>
    );
  }
  const bg = kind === 'pro' ? '#2F4F33' : kind === 'elite' ? colors.primary : '#2D2D30';
  const fg = kind === 'pro' ? '#7BC47F' : kind === 'elite' ? colors.textInverse : colors.text;
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderWidth: 0 }]}>
      <Text style={[styles.badgeTxt, { color: fg }]}>{label}</Text>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.xl, paddingBottom: space.lg, paddingTop: space.sm,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center',
  },
  title: { fontFamily: font.display, fontSize: 30, color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontFamily: font.body, fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  scroll: { paddingHorizontal: space.xl, paddingBottom: 120 },

  // Hero card (profile + stats)
  heroCard: {
    backgroundColor: colors.surface1,
    borderRadius: radii.xl,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  heroName: { fontFamily: font.bodyBold, fontSize: 16, color: colors.text },
  heroHandle: { fontFamily: font.body, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  heroEdit: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: colors.surface3, borderRadius: radii.pill,
    borderWidth: 1, borderColor: colors.border,
  },
  heroEditTxt: { fontFamily: font.bodySemibold, fontSize: 11, color: colors.text },

  statsRow: { flexDirection: 'row', marginTop: space.lg, justifyContent: 'space-between' },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: font.bodyBold, fontSize: 17, color: colors.text, letterSpacing: -0.3 },
  statLabel: { fontFamily: font.body, fontSize: 10, color: colors.textTertiary, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Upsell
  upsell: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.primary, borderRadius: radii.xl,
    padding: space.lg, marginTop: space.lg,
  },
  upsellIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  upsellTitle: { fontFamily: font.bodyBold, fontSize: 15, color: colors.textInverse, letterSpacing: -0.2 },
  upsellBody: { fontFamily: font.body, fontSize: 12, color: 'rgba(0,0,0,0.8)', marginTop: 2 },

  // Section
  section: { marginTop: space.xxl },
  sectionTitle: {
    fontFamily: font.bodySemibold,
    fontSize: 11,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: space.sm,
    marginLeft: space.sm,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Row
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: space.lg, minHeight: 58,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconBox: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: colors.surface3,
    alignItems: 'center', justifyContent: 'center', marginRight: space.md,
    borderWidth: 1, borderColor: colors.border,
  },
  iconBoxDestructive: { backgroundColor: 'rgba(255,95,86,0.12)', borderColor: 'rgba(255,95,86,0.3)' },
  rowTitle: { fontFamily: font.bodySemibold, fontSize: 14, color: colors.text, letterSpacing: -0.1 },
  rowSubtitle: { fontFamily: font.body, fontSize: 11.5, color: colors.textSecondary, marginTop: 2, lineHeight: 15 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  // Badge
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radii.pill,
  },
  badgeLocked: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
  },
  badgeTxt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  badgeTxtLocked: { fontFamily: font.bodyBold, fontSize: 10, color: colors.primary, letterSpacing: 0.4, textTransform: 'uppercase' },

  // Sign out
  signOut: {
    marginTop: space.xxl,
    backgroundColor: colors.surface1,
    borderRadius: radii.xl,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: space.lg, alignItems: 'center',
  },
  signOutTxt: { fontFamily: font.bodyBold, fontSize: 14, color: '#FF5F56', letterSpacing: -0.1 },

  foot: {
    textAlign: 'center',
    fontFamily: font.body,
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: space.xl,
  },
});
