/**
 * PremiumProfileExtras — Apr 2026 Profile tab "creator dashboard" upgrade.
 *
 *   Sits between the existing Hero card and the Tabs bar. Adds:
 *     · Expanded scrollable Stats Row (7 metrics — Followers / Following /
 *       Profile Views / Spot Saves / Posts / Reviews / Referral Leads)
 *     · Quick Actions horizontal row (6 premium buttons)
 *     · Portfolio Highlights grid (best photos pulled from spots)
 *     · Growth Insights card (blurred for Free, unlocked Pro/Elite)
 *     · Subscription Status card (different states by plan)
 *
 *   Uses the user object + already-fetched mySpots/myPosts/photos arrays
 *   from the parent so no extra round-trips. /me/viewers/summary and
 *   /me/referrals are pulled lazily.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Image, Share, Linking,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  TrendingUp, Eye, UserPlus, MessageCircle, Camera, Edit3,
  Crown, Lock, ChevronRight, Sparkles, Heart, Bookmark, MapPin,
  Briefcase, Plus, Star, Gem, Flame, ShieldCheck, BarChart3,
} from 'lucide-react-native';
import { api } from '../api';
import { colors, font, space } from '../theme';

// ============================================================================
// 1. Stats Row (7 metrics — scrollable)
// ============================================================================
function StatTile({
  label, value, accent, onPress, icon,
}: {
  label: string; value: string | number; accent?: string;
  onPress?: () => void; icon?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={st.tile} testID={`stat-${label.toLowerCase().replace(/\s+/g,'-')}`}>
      {icon ? <View style={[st.tileIcon, accent ? { backgroundColor: accent + '14', borderColor: accent + '55' } : null]}>{icon}</View> : null}
      <Text style={st.tileValue}>{value}</Text>
      <Text style={st.tileLabel}>{label}</Text>
    </Pressable>
  );
}

// ============================================================================
// 2. Quick Action button
// ============================================================================
function QuickAction({
  label, icon, onPress, gold, testID,
}: {
  label: string; icon: React.ReactNode; onPress: () => void; gold?: boolean; testID?: string;
}) {
  return (
    <Pressable onPress={onPress} style={[st.qaBtn, gold && st.qaBtnGold]} testID={testID}>
      <View style={[st.qaIcon, gold && st.qaIconGold]}>{icon}</View>
      <Text style={[st.qaLabel, gold && { color: colors.primary }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

// ============================================================================
// MAIN
// ============================================================================
export default function PremiumProfileExtras({
  user,
  mySpots,
  myPosts,
  photos,
  onEdit,
}: {
  user: any;
  mySpots: any[];
  myPosts: any[];
  photos: { url: string; spot_id: string }[];
  onEdit?: () => void;
}) {
  const plan = user?.plan || 'free';
  const isFree = plan === 'free';
  const isPro = plan === 'pro';
  const isElite = plan === 'elite';
  const stats = user?.stats || {};

  // Lazy-fetched daily metrics
  const [viewers, setViewers] = useState<{
    total_7d: number; total_30d: number;
  } | null>(null);
  const [referralCount, setReferralCount] = useState<number>(0);

  useEffect(() => {
    api.get('/me/viewers/summary').then((r) => setViewers(r)).catch(() => {});
    api.get('/me/referrals').then((r) => {
      const items = r?.items || r?.referrals || (Array.isArray(r) ? r : []);
      setReferralCount(items.length || 0);
    }).catch(() => {});
  }, []);

  // Saves received aggregated from spots
  const savesReceived = mySpots.reduce(
    (sum: number, sp: any) => sum + (sp.save_count || sp.saves || 0), 0,
  );
  const reviewsReceived =
    stats.reviews_received ??
    mySpots.reduce((sum: number, sp: any) => sum + (sp.review_count || 0), 0);
  const profileViews30d = viewers?.total_30d ?? stats.profile_views ?? 0;
  const profileViews7d = viewers?.total_7d ?? 0;

  // Top-3 portfolio highlights — most-saved photos (proxy: cover from
  // top-scored spots)
  const highlights = [...mySpots]
    .sort((a, b) => (b.shoot_score || 0) - (a.shoot_score || 0))
    .slice(0, 6)
    .map((sp) => {
      const cover = sp.hero_cover_image_url
        || (sp.images || []).find((i: any) => i.is_cover)?.image_url
        || (sp.images || [])[0]?.image_url;
      return { spot_id: sp.spot_id, title: sp.title, image: cover };
    })
    .filter((h) => !!h.image);

  const onInvite = async () => {
    try {
      const ref = (user as any)?.referral_code;
      const urlBase = 'https://lumascout.app';
      const url = ref ? `${urlBase}?ref=${encodeURIComponent(ref)}` : urlBase;
      await Share.share({
        message: `I'm using LumaScout to find amazing photo spots — come join me 📸\n\n${url}`,
        url,
        title: 'LumaScout',
      });
    } catch {}
  };

  return (
    <View style={{ gap: 18 }}>
      {/* ========================================================== */}
      {/* SECTION — Stats row                                        */}
      {/* ========================================================== */}
      <View>
        <Text style={st.secTitle}>Your stats</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.tileRow}
        >
          <StatTile
            label="Followers"
            value={fmt(stats.followers ?? 0)}
            accent="#60A5FA"
            icon={<UserPlus size={14} color="#60A5FA" />}
            onPress={() => router.push('/followers' as any)}
          />
          <StatTile
            label="Following"
            value={fmt(stats.following ?? 0)}
            accent="#60A5FA"
            icon={<UserPlus size={14} color="#60A5FA" />}
            onPress={() => router.push('/following' as any)}
          />
          <StatTile
            label="Profile Views"
            value={fmt(profileViews30d)}
            accent={colors.primary}
            icon={<Eye size={14} color={colors.primary} />}
            onPress={() => router.push('/profile-viewers' as any)}
          />
          <StatTile
            label="Spot Saves"
            value={fmt(savesReceived)}
            accent="#22c55e"
            icon={<Bookmark size={14} color="#22c55e" />}
          />
          <StatTile
            label="Posts"
            value={fmt(stats.posts_count ?? myPosts.length)}
            accent={colors.primary}
            icon={<Sparkles size={14} color={colors.primary} />}
          />
          <StatTile
            label="Reviews"
            value={fmt(reviewsReceived)}
            accent="#F97316"
            icon={<Star size={14} color="#F97316" />}
          />
          <StatTile
            label="Referrals"
            value={fmt(referralCount)}
            accent="#9D59FF"
            icon={<Briefcase size={14} color="#9D59FF" />}
            onPress={() => router.push('/referrals' as any)}
          />
        </ScrollView>
      </View>

      {/* ========================================================== */}
      {/* SECTION — Quick Actions                                    */}
      {/* ========================================================== */}
      <View>
        <Text style={st.secTitle}>Quick actions</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={st.qaRow}
        >
          <QuickAction
            label={'Upload\nSpot'}
            icon={<Plus size={18} color={colors.text} />}
            onPress={() => router.push('/(tabs)/add' as any)}
            testID="qa-upload"
          />
          <QuickAction
            label={'Create\nPost'}
            icon={<Edit3 size={17} color={colors.text} />}
            onPress={() => router.push('/community/compose' as any)}
            testID="qa-post"
          />
          <QuickAction
            label={'View\nMessages'}
            icon={<MessageCircle size={17} color={colors.text} />}
            onPress={() => router.push('/inbox' as any)}
            testID="qa-messages"
          />
          <QuickAction
            label={'My\nPortfolio'}
            icon={<Camera size={17} color={colors.text} />}
            onPress={() => {
              // If the user has a portfolio website, ensure the URL is
              // prefixed with https:// so iOS Linking doesn't treat it
              // as a local file path (was throwing "Unable to open URL"
              // for raw "www.PetographyTX.com/portfolio").
              const w: string | undefined = user?.website;
              if (w && typeof w === 'string') {
                const url = /^https?:\/\//i.test(w) ? w : `https://${w}`;
                Linking.openURL(url).catch(() => {
                  // Fallback to in-app profile when external URL fails
                  if (user?.user_id) router.push(`/user/${user.user_id}` as any);
                });
              } else if (user?.user_id) {
                router.push(`/user/${user.user_id}` as any);
              } else {
                onEdit?.();
              }
            }}
            testID="qa-portfolio"
          />
          <QuickAction
            label={'Invite\nFriends'}
            icon={<UserPlus size={17} color={colors.text} />}
            onPress={onInvite}
            testID="qa-invite"
          />
          <QuickAction
            label={isFree ? 'Upgrade\nPlan' : 'Manage\nPlan'}
            icon={<Crown size={17} color={isFree ? colors.primary : colors.text} />}
            onPress={() => router.push((isFree ? '/paywall' : '/billing') as any)}
            gold={isFree}
            testID="qa-upgrade"
          />
        </ScrollView>
      </View>

      {/* ========================================================== */}
      {/* SECTION — Portfolio Highlights                             */}
      {/* ========================================================== */}
      <View>
        <View style={st.secTitleRow}>
          <Text style={st.secTitle}>Portfolio highlights</Text>
          {highlights.length > 0 ? (
            <Pressable onPress={() => router.push(`/user/${user.user_id}` as any)} hitSlop={8}>
              <Text style={st.seeAll}>See all</Text>
            </Pressable>
          ) : null}
        </View>
        {highlights.length === 0 ? (
          <Pressable
            onPress={() => router.push('/(tabs)/create' as any)}
            style={st.portfolioEmpty}
          >
            <View style={st.portfolioEmptyIcon}>
              <Camera size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.portfolioEmptyTitle}>Upload your best work</Text>
              <Text style={st.portfolioEmptyBody}>
                Photos attract followers, drive saves, and rank you on the Directory.
              </Text>
            </View>
            <View style={st.portfolioEmptyCta}>
              <Plus size={14} color="#1a1300" />
              <Text style={st.portfolioEmptyCtaTxt}>Upload</Text>
            </View>
          </Pressable>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.xl, gap: 8 }}
          >
            {highlights.map((h, idx) => (
              <Pressable
                key={h.spot_id}
                onPress={() => router.push(`/spot/${h.spot_id}` as any)}
                style={[st.hlCard, idx === 0 ? st.hlCardLg : null]}
              >
                <Image source={{ uri: h.image! }} style={st.hlImg} />
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.85)']}
                  style={st.hlGrad}
                />
                <Text style={st.hlTitle} numberOfLines={1}>{h.title}</Text>
                {idx === 0 ? (
                  <View style={st.hlFeaturedPill}>
                    <Flame size={10} color="#1a1300" />
                    <Text style={st.hlFeaturedTxt}>FEATURED</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ========================================================== */}
      {/* SECTION — Growth Insights                                  */}
      {/* ========================================================== */}
      <View style={{ paddingHorizontal: space.xl }}>
        <View style={[st.secTitleRow, { paddingHorizontal: 0 }]}>
          <Text style={st.secTitleInline}>Growth insights</Text>
          {!isFree ? (
            <Pressable onPress={() => router.push('/analytics' as any)} hitSlop={8}>
              <Text style={st.seeAll}>Analytics</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={st.growthCard}>
          {/* Always-visible top row — last 7d viewers + follower delta */}
          <View style={st.growthRow}>
            <GrowthBlip
              label={`+${profileViews7d || 0} profile views`}
              caption="last 7 days"
              icon={<Eye size={13} color={colors.primary} />}
              accent={colors.primary}
            />
            <GrowthBlip
              label={`+${(stats.followers_delta_7d ?? Math.min(stats.followers ?? 0, 2))} followers`}
              caption="this week"
              icon={<UserPlus size={13} color="#22c55e" />}
              accent="#22c55e"
            />
          </View>
          <View style={st.growthRow}>
            <GrowthBlip
              label={`Saved ${savesReceived} times`}
              caption="across your spots"
              icon={<Bookmark size={13} color="#60A5FA" />}
              accent="#60A5FA"
              blurred={isFree}
            />
            <GrowthBlip
              label={`#${stats.trending_rank ?? 8} in ${user?.city || 'your area'}`}
              caption="creator rank"
              icon={<TrendingUp size={13} color="#F97316" />}
              accent="#F97316"
              blurred={isFree}
            />
          </View>

          {isFree ? (
            <Pressable
              onPress={() => router.push('/paywall' as any)}
              style={st.unlockCta}
              testID="profile-unlock-analytics"
            >
              <Lock size={13} color={colors.primary} />
              <Text style={st.unlockCtaTxt}>
                Unlock full creator analytics with Pro
              </Text>
              <ChevronRight size={14} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ========================================================== */}
      {/* SECTION — Subscription status card                         */}
      {/* ========================================================== */}
      <View style={{ paddingHorizontal: space.xl }}>
        <SubscriptionCard plan={plan} isFree={isFree} isPro={isPro} isElite={isElite} />
      </View>
    </View>
  );
}

// ============================================================================
// Sub-components
// ============================================================================
function GrowthBlip({
  label, caption, icon, accent, blurred,
}: {
  label: string; caption: string; icon: React.ReactNode; accent: string; blurred?: boolean;
}) {
  return (
    <View style={[st.blip, { borderColor: accent + '33' }]}>
      <View style={[st.blipIcon, { backgroundColor: accent + '1a', borderColor: accent + '55' }]}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[st.blipLabel, blurred && st.blurred]}>{label}</Text>
        <Text style={st.blipCaption}>{caption}</Text>
      </View>
      {blurred ? (
        <View style={st.blipLock}>
          <Lock size={11} color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

function SubscriptionCard({
  plan, isFree, isPro, isElite,
}: { plan: string; isFree: boolean; isPro: boolean; isElite: boolean }) {
  if (isElite) {
    return (
      <Pressable
        onPress={() => router.push('/billing' as any)}
        style={[st.subCard, st.subElite]}
      >
        <LinearGradient
          colors={['rgba(245,166,35,0.22)', 'rgba(245,166,35,0.04)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: 22 }]}
        />
        <View style={st.subIconElite}>
          <Gem size={20} color="#1a1300" />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={st.subTitleElite}>Elite Creator Status Active</Text>
          <Text style={st.subBody}>
            Featured placement · Advanced analytics · Referral priority · Gold badge
          </Text>
        </View>
        <ChevronRight size={16} color={colors.primary} />
      </Pressable>
    );
  }
  if (isPro) {
    return (
      <Pressable
        onPress={() => router.push('/billing' as any)}
        style={[st.subCard, st.subPro]}
      >
        <View style={st.subIconPro}>
          <Crown size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={st.subTitlePro}>Enjoying Pro Benefits</Text>
          <Text style={st.subBody}>
            Profile viewers · Pro badge · Advanced search · Unlimited collections
          </Text>
        </View>
        <ChevronRight size={16} color={colors.text} />
      </Pressable>
    );
  }
  // Free
  return (
    <Pressable
      onPress={() => router.push('/paywall' as any)}
      style={[st.subCard, st.subFree]}
      testID="subscription-upgrade"
    >
      <LinearGradient
        colors={['rgba(245,166,35,0.18)', 'rgba(245,166,35,0.04)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 22 }]}
      />
      <View style={st.subIconPro}>
        <Crown size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={st.subTitlePro}>Upgrade to Pro</Text>
        <Text style={st.subBody}>
          Unlock viewer analytics, Pro badge, priority directory placement, unlimited collections.
        </Text>
      </View>
      <View style={st.subCta}>
        <Text style={st.subCtaTxt}>Go Pro</Text>
        <ChevronRight size={14} color="#1a1300" />
      </View>
    </Pressable>
  );
}

// ============================================================================
// Helpers
// ============================================================================
function fmt(n: number | string): string {
  const v = typeof n === 'number' ? n : parseInt(String(n), 10) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

// ============================================================================
// Styles
// ============================================================================
const st = StyleSheet.create({
  // Section title
  secTitle: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 16,
    letterSpacing: -0.2,
    paddingHorizontal: space.xl,
    marginBottom: 10,
  },
  secTitleInline: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 16,
    letterSpacing: -0.2,
    marginBottom: 10,
  },
  secTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
  },
  seeAll: {
    color: colors.primary,
    fontFamily: font.bodySemibold,
    fontSize: 12,
    marginBottom: 10,
  },

  // Stat tile (110 wide)
  tileRow: {
    paddingHorizontal: space.xl,
    gap: 8,
  },
  tile: {
    width: 108,
    padding: 12,
    borderRadius: 18,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  tileIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 4,
  },
  tileValue: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 22,
    letterSpacing: -0.4,
  },
  tileLabel: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.1,
  },

  // Quick actions
  qaRow: {
    paddingHorizontal: space.xl,
    gap: 8,
  },
  qaBtn: {
    width: 90,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 18,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 8,
  },
  qaBtnGold: {
    borderColor: 'rgba(245,166,35,0.6)',
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  qaIcon: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  qaIconGold: {
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderColor: 'rgba(245,166,35,0.4)',
  },
  qaLabel: {
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 13,
  },

  // Portfolio highlights
  hlCard: {
    width: 140,
    height: 180,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hlCardLg: {
    width: 200,
  },
  hlImg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    width: '100%', height: '100%',
  },
  hlGrad: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: '55%',
  },
  hlTitle: {
    position: 'absolute', left: 10, right: 10, bottom: 10,
    color: '#fff',
    fontFamily: font.bodyBold,
    fontSize: 12,
  },
  hlFeaturedPill: {
    position: 'absolute', top: 10, left: 10,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  hlFeaturedTxt: {
    color: '#1a1300',
    fontFamily: font.bodyBold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  portfolioEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: space.xl,
    padding: 14,
    borderRadius: 22,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    borderStyle: 'dashed',
  },
  portfolioEmptyIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
  },
  portfolioEmptyTitle: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 13,
  },
  portfolioEmptyBody: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 11,
    marginTop: 2,
  },
  portfolioEmptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
  },
  portfolioEmptyCtaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 11 },

  // Growth insights
  growthCard: {
    padding: 12,
    borderRadius: 22,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  growthRow: {
    flexDirection: 'row',
    gap: 8,
  },
  blip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
  },
  blipIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  blipLabel: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 12.5,
  },
  blipCaption: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 10.5,
    marginTop: 1,
  },
  blurred: {
    color: 'rgba(255,255,255,0.4)',
    // Visual cue — react-native doesn't support text blur cross-platform.
    // Combined with the lock icon this reads as "obscured for free users".
  },
  blipLock: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
  },
  unlockCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.45)',
  },
  unlockCtaTxt: {
    flex: 1,
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 12.5,
  },

  // Subscription card
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subFree: {
    borderColor: 'rgba(245,166,35,0.45)',
  },
  subPro: {
    borderColor: 'rgba(245,166,35,0.45)',
  },
  subElite: {
    borderColor: 'rgba(245,166,35,0.7)',
  },
  subIconPro: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.45)',
  },
  subIconElite: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  subTitlePro: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  subTitleElite: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 0.2 },
  subBody: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 11.5,
    lineHeight: 15,
  },
  subCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  subCtaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 12 },
});
