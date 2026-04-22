/**
 * Who Viewed Your Profile — Phase B.1
 *
 * Premium three-tier rendering (free / pro / elite):
 *   • Free   → blurred avatars + teaser count + Go Pro CTA
 *   • Pro    → full viewer list with Follow-back + Message CTAs
 *   • Elite  → full list + analytics cards (Top Cities / Top Niches /
 *              Repeat Viewers / 7-day trend)
 *
 * Records profile views side-effect-free via the existing
 * GET /api/users/{id} endpoint (auto-logged on viewer side, deduped
 * within a 1h window).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import {
  ArrowLeft,
  Eye,
  Crown,
  UserPlus,
  UserCheck,
  MessageCircle,
  MapPin,
  TrendingUp,
  Users,
  BarChart3,
  Lock,
} from 'lucide-react-native';
import { api, formatApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import VerifiedBadge from '../src/components/VerifiedBadge';

type Viewer = {
  user_id: string;
  name: string;
  username?: string;
  avatar_url?: string | null;
  city?: string;
  state?: string;
  specialties?: string[];
  verification_status?: string;
  plan?: 'free' | 'pro' | 'elite';
  last_viewed_at: string;
  view_count: number;
  is_following?: boolean;
};

type Analytics = {
  top_cities: Array<{ city: string; views: number }>;
  top_specialties: Array<{ specialty: string; viewers: number }>;
  repeat_viewers: number;
  trend_7d: Array<{ date: string; views: number }>;
};

type ViewersResponse = {
  plan: 'free' | 'pro' | 'elite' | string;
  total_views: number;
  total_impressions: number;
  period_days: number;
  viewers: Viewer[];
  teaser?: {
    blurred_avatars: Array<string | null>;
    blurred_initials: string[];
    message: string;
  };
  analytics?: Analytics;
};

// ---------------------------------------------------------------------------
// Relative time helper ("2h ago")
// ---------------------------------------------------------------------------
function relativeTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, (now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function ProfileViewers() {
  const { user } = useAuth();
  const [data, setData] = useState<ViewersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingFollow, setPendingFollow] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await api.get('/me/viewers', { limit: 50, since_days: 30 });
      setData(resp);
    } catch (e) {
      console.warn('viewers load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const onFollow = async (viewer: Viewer) => {
    if (pendingFollow) return;
    setPendingFollow(viewer.user_id);
    try {
      await api.post(`/users/${viewer.user_id}/follow`);
      // optimistic toggle
      setData((d) => d ? {
        ...d,
        viewers: d.viewers.map((v) => v.user_id === viewer.user_id
          ? { ...v, is_following: !v.is_following }
          : v),
      } : d);
    } catch (e) {
      Alert.alert('Follow failed', formatApiError(e));
    } finally {
      setPendingFollow(null);
    }
  };

  const onMessage = async (viewer: Viewer) => {
    try {
      const resp = await api.post('/dm/threads/start', {
        user_id: viewer.user_id,
        opening_body: null,
      });
      if (resp?.thread_id) {
        router.push(`/inbox/${resp.thread_id}` as any);
      }
    } catch (e) {
      Alert.alert('Could not start conversation', formatApiError(e));
    }
  };

  // ---- Render subtree ---------------------------------------------------
  const tier = data?.plan || 'free';
  const canSeeFullList = tier === 'pro' || tier === 'elite';
  const showAnalytics = tier === 'elite';

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          testID="viewers-back"
          hitSlop={10}
        >
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Viewers</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && !data ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {/* Hero summary */}
          <HeroSummary data={data} />

          {/* Elite analytics */}
          {showAnalytics && data?.analytics ? (
            <AnalyticsBlock a={data.analytics} />
          ) : null}

          {/* Free-tier teaser (blurred) */}
          {!canSeeFullList ? (
            <FreeTierTeaser data={data} />
          ) : (
            <View style={{ marginTop: space.lg }}>
              <Text style={styles.sectionLabel}>Recent viewers</Text>
              {data?.viewers && data.viewers.length > 0 ? (
                data.viewers.map((v) => (
                  <ViewerCard
                    key={v.user_id}
                    viewer={v}
                    busy={pendingFollow === v.user_id}
                    onFollow={() => onFollow(v)}
                    onMessage={() => onMessage(v)}
                    onOpen={() => router.push(`/user/${v.user_id}` as any)}
                  />
                ))
              ) : (
                <EmptyState />
              )}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function HeroSummary({ data }: { data: ViewersResponse | null }) {
  const total = data?.total_views ?? 0;
  const impressions = data?.total_impressions ?? 0;
  return (
    <View style={styles.hero}>
      <View style={styles.heroIconWrap}>
        <Eye size={22} color={colors.primary} />
      </View>
      <Text style={styles.heroNumber} testID="viewers-total-count">{total}</Text>
      <Text style={styles.heroLabel}>
        {total === 1 ? 'photographer viewed your profile' : 'photographers viewed your profile'}
      </Text>
      <Text style={styles.heroSub}>
        In the last 30 days · {impressions} total impression{impressions === 1 ? '' : 's'}
      </Text>
    </View>
  );
}

function FreeTierTeaser({ data }: { data: ViewersResponse | null }) {
  const teaser = data?.teaser;
  const avatars = teaser?.blurred_avatars || [];
  const initials = teaser?.blurred_initials || [];
  const hasViews = (data?.total_views ?? 0) > 0;

  return (
    <View style={styles.teaserCard} testID="viewers-free-teaser">
      <View style={styles.teaserAvatarsRow}>
        {Array.from({ length: Math.max(3, avatars.length) }).map((_, i) => (
          <View key={i} style={[styles.teaserAvatarWrap, { zIndex: 3 - i, marginLeft: i === 0 ? 0 : -14 }]}>
            {avatars[i] ? (
              <Image
                source={{ uri: avatars[i] as string }}
                style={styles.teaserAvatar}
                blurRadius={12}
              />
            ) : (
              <View style={[styles.teaserAvatar, styles.teaserAvatarFallback]}>
                <Text style={styles.teaserAvatarInitials}>{initials[i] || '?'}</Text>
              </View>
            )}
            <View style={styles.teaserLockBadge}>
              <Lock size={10} color={colors.textInverse} />
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.teaserHeadline}>
        {hasViews ? teaser?.message : "No viewers yet — keep sharing!"}
      </Text>
      <Text style={styles.teaserSub}>
        {hasViews
          ? 'Upgrade to Pro to see names, cities, and follow back in one tap.'
          : 'When other photographers check out your profile, you\'ll see them here.'}
      </Text>

      {hasViews ? (
        <TouchableOpacity
          style={styles.upgradeBtn}
          onPress={() => router.push('/paywall?reason=viewers' as any)}
          testID="viewers-upgrade-cta"
        >
          <Crown size={14} color={colors.textInverse} />
          <Text style={styles.upgradeBtnTxt}>Unlock with Pro</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.perksRow}>
        <Text style={styles.perksHeadline}>With Pro you get:</Text>
        <Perk text="See every viewer's name + city" />
        <Perk text="Follow back in one tap" />
        <Perk text="Message them directly" />
      </View>
    </View>
  );
}

function Perk({ text }: { text: string }) {
  return (
    <View style={styles.perkRow}>
      <View style={styles.perkDot} />
      <Text style={styles.perkTxt}>{text}</Text>
    </View>
  );
}

function ViewerCard({
  viewer, busy, onFollow, onMessage, onOpen,
}: {
  viewer: Viewer; busy: boolean;
  onFollow: () => void; onMessage: () => void; onOpen: () => void;
}) {
  const isVerified = viewer.verification_status === 'verified';
  const cityLine = [viewer.city, viewer.state].filter(Boolean).join(', ');
  const following = !!viewer.is_following;
  return (
    <View style={styles.card} testID={`viewer-${viewer.user_id}`}>
      <TouchableOpacity
        style={styles.cardMain}
        onPress={onOpen}
        activeOpacity={0.85}
      >
        {viewer.avatar_url ? (
          <Image source={{ uri: viewer.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {(viewer.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.cardName} numberOfLines={1}>{viewer.name}</Text>
            {isVerified && <VerifiedBadge size={12} />}
          </View>
          {cityLine ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <MapPin size={11} color={colors.textTertiary} />
              <Text style={styles.cardMeta} numberOfLines={1}>{cityLine}</Text>
            </View>
          ) : null}
          <Text style={styles.cardTimestamp}>
            {viewer.view_count > 1 ? `Viewed ${viewer.view_count}× · ` : ''}
            {relativeTime(viewer.last_viewed_at)}
          </Text>
        </View>
      </TouchableOpacity>
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={[styles.actionBtn, following ? styles.actionBtnSecondary : styles.actionBtnPrimary]}
          onPress={onFollow}
          disabled={busy}
          testID={`viewer-${viewer.user_id}-follow`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={following ? colors.text : colors.textInverse} />
          ) : following ? (
            <UserCheck size={14} color={colors.text} />
          ) : (
            <UserPlus size={14} color={colors.textInverse} />
          )}
          <Text style={following ? styles.actionTxtSecondary : styles.actionTxtPrimary}>
            {following ? 'Following' : 'Follow back'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnGhost]}
          onPress={onMessage}
          testID={`viewer-${viewer.user_id}-message`}
        >
          <MessageCircle size={14} color={colors.primary} />
          <Text style={styles.actionTxtGhost}>Message</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AnalyticsBlock({ a }: { a: Analytics }) {
  const maxTrend = Math.max(1, ...a.trend_7d.map((t) => t.views));
  return (
    <View style={styles.analyticsWrap}>
      <View style={styles.analyticsHeader}>
        <BarChart3 size={14} color={colors.primary} />
        <Text style={styles.analyticsLabel}>Elite Analytics</Text>
      </View>

      <View style={styles.analyticsCardsRow}>
        <View style={styles.analyticsCard}>
          <Text style={styles.analyticsCardNumber}>{a.repeat_viewers}</Text>
          <Text style={styles.analyticsCardSub}>Repeat viewers</Text>
        </View>
        <View style={styles.analyticsCard}>
          <Text style={styles.analyticsCardNumber}>
            {a.trend_7d.reduce((s, d) => s + d.views, 0)}
          </Text>
          <Text style={styles.analyticsCardSub}>Views this week</Text>
        </View>
      </View>

      {/* Trend sparkline */}
      <View style={styles.trendCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <TrendingUp size={13} color={colors.primary} />
          <Text style={styles.trendTitle}>7-day trend</Text>
        </View>
        <View style={styles.trendRow}>
          {a.trend_7d.map((d, i) => {
            const h = Math.max(4, (d.views / maxTrend) * 44);
            const label = new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1);
            return (
              <View key={i} style={styles.trendBarCol}>
                <View style={[styles.trendBar, { height: h }]} />
                <Text style={styles.trendBarLabel}>{label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {a.top_cities.length > 0 ? (
        <View style={styles.listCard}>
          <Text style={styles.listCardTitle}>Top cities viewing you</Text>
          {a.top_cities.map((c, i) => (
            <View key={i} style={styles.listRow}>
              <Text style={styles.listRowLabel}>{c.city}</Text>
              <Text style={styles.listRowValue}>{c.views} view{c.views === 1 ? '' : 's'}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {a.top_specialties.length > 0 ? (
        <View style={styles.listCard}>
          <Text style={styles.listCardTitle}>Niches viewing your profile</Text>
          {a.top_specialties.map((s, i) => (
            <View key={i} style={styles.listRow}>
              <Text style={styles.listRowLabel}>{s.specialty}</Text>
              <Text style={styles.listRowValue}>{s.viewers} viewer{s.viewers === 1 ? '' : 's'}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyCard}>
      <Users size={28} color={colors.textTertiary} />
      <Text style={styles.emptyHead}>No viewers yet</Text>
      <Text style={styles.emptySub}>
        When other photographers check out your profile, they'll show up here.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16, letterSpacing: 0.3 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  hero: {
    alignItems: 'center',
    backgroundColor: colors.surface1,
    borderColor: 'rgba(245,166,35,0.28)', borderWidth: 1,
    borderRadius: radii.lg,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    gap: 6,
  },
  heroIconWrap: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  heroNumber: { color: colors.primary, fontFamily: font.display, fontSize: 44, letterSpacing: -1 },
  heroLabel: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 14, textAlign: 'center' },
  heroSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12, marginTop: 4 },

  sectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 1, textTransform: 'uppercase', marginTop: space.xl, marginBottom: space.md,
  },

  // Free teaser
  teaserCard: {
    marginTop: space.lg,
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.lg,
    alignItems: 'center', gap: 8,
  },
  teaserAvatarsRow: { flexDirection: 'row', marginBottom: space.sm },
  teaserAvatarWrap: {
    position: 'relative',
    width: 54, height: 54,
  },
  teaserAvatar: {
    width: 54, height: 54, borderRadius: 27,
    borderWidth: 2, borderColor: colors.surface1,
    backgroundColor: colors.surface2,
  },
  teaserAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  teaserAvatarInitials: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 18 },
  teaserLockBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface1,
  },
  teaserHeadline: {
    color: colors.text, fontFamily: font.bodyBold, fontSize: 16,
    textAlign: 'center', marginTop: space.xs,
  },
  teaserSub: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13,
    textAlign: 'center', lineHeight: 18, paddingHorizontal: space.md,
  },
  upgradeBtn: {
    marginTop: space.md,
    backgroundColor: colors.primary,
    paddingVertical: 12, paddingHorizontal: space.xl,
    borderRadius: radii.md,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  upgradeBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 0.3 },

  perksRow: {
    alignSelf: 'stretch',
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1, borderTopColor: colors.border,
    gap: 6,
  },
  perksHeadline: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4,
  },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  perkDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  perkTxt: { color: colors.text, fontFamily: font.body, fontSize: 13 },

  // Viewer card
  card: {
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md,
    padding: space.md,
    marginBottom: space.sm,
    gap: space.sm,
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 18 },
  cardName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  cardMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12 },
  cardTimestamp: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 2 },

  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: radii.md,
  },
  actionBtnPrimary: { backgroundColor: colors.primary },
  actionBtnSecondary: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  actionBtnGhost: { borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)', backgroundColor: 'transparent' },
  actionTxtPrimary: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
  actionTxtSecondary: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  actionTxtGhost: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 },

  // Elite analytics
  analyticsWrap: { marginTop: space.xl, gap: space.md },
  analyticsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  analyticsLabel: {
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 11,
    letterSpacing: 1, textTransform: 'uppercase',
  },
  analyticsCardsRow: { flexDirection: 'row', gap: space.md },
  analyticsCard: {
    flex: 1,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: space.md, alignItems: 'center',
  },
  analyticsCardNumber: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  analyticsCardSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 4, textAlign: 'center' },

  trendCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: space.md,
  },
  trendTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 70, paddingHorizontal: 4 },
  trendBarCol: { alignItems: 'center', flex: 1, gap: 4 },
  trendBar: { width: 10, backgroundColor: colors.primary, borderRadius: 3, minHeight: 3 },
  trendBarLabel: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10 },

  listCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, padding: space.md,
  },
  listCardTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13, marginBottom: 8 },
  listRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  listRowLabel: { color: colors.text, fontFamily: font.body, fontSize: 13 },
  listRowValue: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 12 },

  // Empty
  emptyCard: {
    alignItems: 'center', padding: space.xl, gap: 8,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md,
  },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
