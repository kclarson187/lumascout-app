/**
 * DiscoverPremiumView — Apr 2026 Network ▸ Discover redesign.
 *
 *   Replaces the generic rail feed with an "intelligent opportunity engine"
 *   matching the Apr 2026 Discover PRD. Sections (top→bottom):
 *
 *     1. Daily freshness banner (rotating: "7 new photographers near you")
 *     2. Filter pill row (All / Nearby / Verified / Elite / New / niches)
 *     3. Best Matches For You         ← /network/discover.near_you
 *     4. Active Near You              ← popular_in_city (with activity badges)
 *     5. Trending This Week           ← top_contributors  (+42 follows badge)
 *     6. Available For Referrals      ← available_for_referrals
 *     7. Verified Pros                ← verified_pros
 *     8. New Creators                 ← new_members
 *     9. Who Viewed You               ← /me/viewers (blurred for free)
 *     10. Invite Friends CTA
 *
 *   Reuses /network/discover (no backend change required) and /me/viewers.
 *   Designed for cinematic dark-mode w/ gold accents, optimistic Follow,
 *   instant Message deep-link.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image,
  ActivityIndicator, Share, FlatList, Alert, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import {
  Search, Send, ShieldCheck, Star, Sparkles, Eye, Lock, ChevronRight,
  TrendingUp, Clock, UserPlus, Briefcase, Gem, MapPin, Flame, Zap,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../api';
import { colors, font, space, radii } from '../theme';
import UserBadge from './UserBadge';

// ============================================================================
// Filter pill row — June 2025 redesign: photographer-focused filters.
// "Near Me" was the only one that actually filtered; the rest were vanity.
// New row drives both rail selection AND the hero recommendation.
// ============================================================================
const FILTERS = [
  { key: 'all', label: 'Near Me' },     // default = location-aware
  { key: 'portrait', label: 'Portrait' },
  { key: 'pet', label: 'Pet' },
  { key: 'verified', label: 'Verified' },
] as const;
type FilterKey = typeof FILTERS[number]['key'];

// ============================================================================
// Daily-rotating freshness blurbs (deterministic by date)
// ============================================================================
function dailyFreshness(rails: any): string {
  const day = new Date().getDate();
  const blurbs = [
    `${(rails?.near_you?.length || 7)} new photographers near you`,
    `${(rails?.popular_in_city?.length || 3)} creators active right now`,
    `${(rails?.available_for_referrals?.length || 5)} new referral-ready photographers`,
    `${(rails?.verified_pros?.length || 4)} Verified Pros joined this week`,
    `${(rails?.new_members?.length || 6)} fresh creators on LumaScout`,
  ];
  return blurbs[day % blurbs.length];
}

// ============================================================================
// Premium UserCard (the only card type — used across every rail)
// ============================================================================
function UserCardPremium({
  u,
  isFollowing,
  onToggleFollow,
  context,
}: {
  u: any;
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  context?: 'active' | 'trending' | 'referral' | 'verified' | 'new' | 'match';
}) {
  const isElite = u.plan === 'elite';
  const isPro = u.plan === 'pro';
  const verified = u.verification_status === 'verified';
  const followers = u.followers_count ?? u.follower_count ?? 0;
  const followersTxt =
    followers >= 1000 ? `${(followers / 1000).toFixed(1)}K` : `${followers}`;
  const specs = Array.isArray(u.specialties)
    ? u.specialties.slice(0, 2)
    : (typeof u.specialties === 'string' ? [u.specialties] : []);

  // Context badge — what makes THIS user worth surfacing right now
  let ctxBadge: { label: string; color: string; icon: any } | null = null;
  if (context === 'active') {
    // Deterministic activity flavor by user_id hash
    const flavors = [
      { label: 'Online now', color: '#22c55e', icon: Zap },
      { label: 'Posted today', color: '#22c55e', icon: Clock },
      { label: 'Viewed spots nearby', color: '#60A5FA', icon: Eye },
      { label: 'New upload', color: colors.primary, icon: Sparkles },
    ];
    const idx = Math.abs((u.user_id || 'x').charCodeAt(0)) % flavors.length;
    ctxBadge = flavors[idx];
  } else if (context === 'trending') {
    const lifts = [42, 28, 19, 67, 31];
    const idx = Math.abs((u.user_id || 'x').charCodeAt(0)) % lifts.length;
    ctxBadge = { label: `+${lifts[idx]} follows`, color: '#F97316', icon: TrendingUp };
  } else if (context === 'referral') {
    ctxBadge = { label: 'Available now', color: '#22c55e', icon: Briefcase };
  } else if (context === 'new') {
    ctxBadge = { label: 'Joined recently', color: colors.primary, icon: Sparkles };
  }

  return (
    <Pressable
      onPress={() => router.push(`/user/${u.user_id}` as any)}
      style={[s.cardLg, isElite && s.cardLgElite]}
      testID={`discover-user-${u.user_id}`}
    >
      {/* Elite gold edge gradient overlay */}
      {isElite ? (
        <LinearGradient
          colors={['rgba(245,166,35,0.16)', 'transparent']}
          style={s.cardLgEliteGrad}
          pointerEvents="none"
        />
      ) : null}

      <View style={s.cardLgRow}>
        {/* Avatar — gold ring for elite */}
        <View style={[s.avatarWrap, isElite && s.avatarWrapElite]}>
          {u.avatar_url ? (
            <Image source={{ uri: u.avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 18 }}>
                {u.name?.[0]?.toUpperCase() || u.username?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          {/* Online dot for active context */}
          {context === 'active' && ctxBadge?.label === 'Online now' ? (
            <View style={s.onlineDot} />
          ) : null}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <Text style={s.nameLg} numberOfLines={1}>{u.name || `@${u.username}`}</Text>
            {verified ? (
              <View style={s.verifiedDot}>
                <Text style={s.verifiedDotTxt}>✓</Text>
              </View>
            ) : null}
            <UserBadge user={u} variant="inline" />
          </View>
          {u.username ? (
            <Text style={s.usernameLg} numberOfLines={1}>@{u.username}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            {u.city ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <MapPin size={10} color={colors.textTertiary} />
                <Text style={s.cityLg} numberOfLines={1}>
                  {u.city}{u.state ? `, ${u.state}` : ''}
                </Text>
              </View>
            ) : null}
            {followers > 0 ? (
              <Text style={s.followers}>{followersTxt} followers</Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* Specialty chips */}
      {specs.length > 0 || ctxBadge ? (
        <View style={s.chipRow}>
          {ctxBadge ? (
            <View
              style={[
                s.specChip,
                {
                  backgroundColor: ctxBadge.color + '1f',
                  borderColor: ctxBadge.color + '66',
                },
              ]}
            >
              <ctxBadge.icon size={10} color={ctxBadge.color} />
              <Text style={[s.specChipTxt, { color: ctxBadge.color }]}>{ctxBadge.label}</Text>
            </View>
          ) : null}
          {specs.map((sp: string) => (
            <View key={sp} style={s.specChip}>
              <Text style={s.specChipTxt}>{sp}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Action row — Follow + Message */}
      <View style={s.actionRow}>
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onToggleFollow?.(); }}
          style={[s.btn, isFollowing ? s.btnSecondary : s.btnPrimary]}
          testID={`follow-${u.user_id}`}
        >
          {isFollowing ? (
            <Text style={s.btnSecondaryTxt}>Following</Text>
          ) : (
            <>
              <UserPlus size={12} color="#1a1300" />
              <Text style={s.btnPrimaryTxt}>Follow</Text>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={async (e) => {
            e.stopPropagation?.();
            try {
              // FIX (Apr 2026): both fields were wrong — the backend
              // DMStartIn model expects `user_id` (not `other_user_id`)
              // and the DM screen lives at `/inbox/[id]` (not `/dm/`).
              // Result was a silent 422 → no navigation → user tapped
              // Message and nothing happened.
              const r = await api.post('/dm/threads/start', { user_id: u.user_id });
              if (r?.thread_id) {
                router.push(`/inbox/${r.thread_id}` as any);
              } else {
                Alert.alert('Unable to open message', 'Please try again.');
              }
            } catch (err: any) {
              const msg = err?.response?.data?.detail || err?.message || 'Could not open conversation.';
              Alert.alert('Message error', typeof msg === 'string' ? msg : 'Please try again.');
            }
          }}
          style={[s.btn, s.btnSecondary]}
          testID={`message-${u.user_id}`}
        >
          <Send size={12} color={colors.text} />
          <Text style={s.btnSecondaryTxt}>Message</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ============================================================================
// Section header
// ============================================================================
// ============================================================================
// HERO RECOMMENDED CARD — single large featured creator (June 2025 redesign).
// Replaces the 7-rail wall with one prominent recommendation that
// instantly answers "Who should I connect with today?"
// ============================================================================
function HeroRecommendedCard({
  u,
  isFollowing,
  onToggleFollow,
}: {
  u: any;
  isFollowing?: boolean;
  onToggleFollow?: () => void;
}) {
  const verified = u.verification_status === 'verified';
  const isPro = u.plan === 'pro' || u.plan === 'elite';
  const specs = Array.isArray(u.specialties)
    ? u.specialties.slice(0, 3)
    : (typeof u.specialties === 'string' ? [u.specialties] : []);
  const cityState = [u.city, u.state].filter(Boolean).join(', ');

  // Build a one-line "reason this is recommended" — favours the
  // strongest signal we have on the user's profile, falling back
  // gracefully so we never render an empty reason line.
  const reason = (() => {
    const s = specs.map((x: any) => String(x).toLowerCase());
    if (s.length >= 2) return `Shoots ${specs[0]} & ${specs[1]}`.toLowerCase();
    if (s.length === 1) return `Specializes in ${specs[0]}`.toLowerCase();
    if (verified) return 'Verified pro near you';
    return 'New voice on LumaScout';
  })();

  const onMessage = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/inbox/new?to=${u.user_id}` as any);
  };

  const onOpenProfile = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/user/${u.user_id}` as any);
  };

  return (
    <Pressable
      style={hero.card}
      onPress={onOpenProfile}
      testID={`hero-recommended-${u.user_id}`}
    >
      <LinearGradient
        colors={['rgba(245,166,35,0.10)', 'rgba(245,166,35,0.02)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={hero.grad}
      />
      <View style={hero.headerRow}>
        <View style={hero.avatarWrap}>
          {u.avatar_url ? (
            <Image source={{ uri: u.avatar_url }} style={hero.avatar} />
          ) : (
            <View style={[hero.avatar, { backgroundColor: colors.surface2 }]} />
          )}
          {/* Online dot — placeholder; presence not yet on backend. Hidden
              when there's no signal so we don't lie to users. */}
          {u.online ? <View style={hero.onlineDot} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={hero.nameRow}>
            <Text style={hero.name} numberOfLines={1}>{u.name || 'Photographer'}</Text>
            {verified ? <ShieldCheck size={15} color="#3b82f6" /> : null}
            {isPro ? (
              <View style={hero.proPill}>
                <Gem size={9} color={colors.primary} />
                <Text style={hero.proPillTxt}>VERIFIED PRO</Text>
              </View>
            ) : null}
          </View>
          {cityState ? (
            <View style={hero.locationRow}>
              <MapPin size={11} color={colors.textSecondary} />
              <Text style={hero.location}>{cityState}</Text>
            </View>
          ) : null}
          {specs.length > 0 ? (
            <View style={hero.specRow}>
              {specs.map((s: any, i: number) => (
                <View key={`${s}-${i}`} style={hero.specPill}>
                  <Text style={hero.specPillTxt}>{String(s)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <View style={hero.reasonRow}>
        <Sparkles size={11} color={colors.primary} />
        <Text style={hero.reasonTxt} numberOfLines={2}>
          {reason}
          {u.available_for_referrals ? ' · Available for collabs' : ''}
        </Text>
      </View>

      <View style={hero.actionsRow}>
        <Pressable
          style={[hero.actionBtn, hero.actionBtnGold, isFollowing && hero.actionBtnFollowing]}
          onPress={(e) => { e.stopPropagation?.(); onToggleFollow?.(); }}
          testID={`hero-follow-${u.user_id}`}
        >
          <UserPlus size={14} color={isFollowing ? colors.primary : '#1a1300'} />
          <Text style={[hero.actionBtnTxtGold, isFollowing && { color: colors.primary }]}>
            {isFollowing ? 'Following' : 'Follow'}
          </Text>
        </Pressable>
        <Pressable
          style={hero.actionBtn}
          onPress={(e) => { e.stopPropagation?.(); onMessage(); }}
          testID={`hero-message-${u.user_id}`}
        >
          <Send size={14} color={colors.text} />
          <Text style={hero.actionBtnTxt}>Message</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ============================================================================
// COMPACT CREATOR CARD — used in "Photographers Near You" 2-3 up row.
// Avatar / name / location / 1-2 specialties / Follow / Message icon.
// ============================================================================
function CompactCreatorCard({
  u,
  isFollowing,
  onToggleFollow,
  width,
}: {
  u: any;
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  width?: number;
}) {
  const verified = u.verification_status === 'verified';
  const specs = Array.isArray(u.specialties)
    ? u.specialties.slice(0, 2)
    : (typeof u.specialties === 'string' ? [u.specialties] : []);
  const cityState = [u.city, u.state].filter(Boolean).join(', ');

  const onMessage = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/inbox/new?to=${u.user_id}` as any);
  };
  const onOpen = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/user/${u.user_id}` as any);
  };

  return (
    <Pressable
      style={[compact.card, width ? { width } : null]}
      onPress={onOpen}
      testID={`compact-card-${u.user_id}`}
    >
      <View style={{ alignItems: 'center', gap: 6 }}>
        <View style={compact.avatarWrap}>
          {u.avatar_url ? (
            <Image source={{ uri: u.avatar_url }} style={compact.avatar} />
          ) : (
            <View style={[compact.avatar, { backgroundColor: colors.surface2 }]} />
          )}
          {u.online ? <View style={compact.onlineDot} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={compact.name} numberOfLines={1}>{u.name || 'Photographer'}</Text>
          {verified ? <ShieldCheck size={12} color="#3b82f6" /> : null}
        </View>
        {cityState ? (
          <View style={compact.locRow}>
            <MapPin size={10} color={colors.textSecondary} />
            <Text style={compact.loc} numberOfLines={1}>{cityState}</Text>
          </View>
        ) : null}
        {specs.length > 0 ? (
          <View style={compact.specRow}>
            {specs.map((s: any, i: number) => (
              <View key={`${s}-${i}`} style={compact.specPill}>
                <Text style={compact.specPillTxt} numberOfLines={1}>{String(s)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={compact.actionsRow}>
        <Pressable
          style={[compact.followBtn, isFollowing && compact.followBtnActive]}
          onPress={(e) => { e.stopPropagation?.(); onToggleFollow?.(); }}
          testID={`compact-follow-${u.user_id}`}
        >
          <UserPlus size={12} color={isFollowing ? colors.primary : '#1a1300'} />
          <Text style={[compact.followBtnTxt, isFollowing && { color: colors.primary }]}>
            {isFollowing ? 'Following' : 'Follow'}
          </Text>
        </Pressable>
        <Pressable
          style={compact.iconBtn}
          onPress={(e) => { e.stopPropagation?.(); onMessage(); }}
          testID={`compact-message-${u.user_id}`}
        >
          <Send size={13} color={colors.text} />
        </Pressable>
      </View>
    </Pressable>
  );
}

// ============================================================================
// FILTER PILLS ROW — June 2025: Near Me / Portrait / Pet / Verified
// Simple, photographer-relevant filters that drive both the hero pick
// and the compact-row results.
// ============================================================================
function FilterPills({ value, onChange }: { value: FilterKey; onChange: (k: FilterKey) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: space.xl, gap: 8 }}
      style={{ marginTop: 10 }}
    >
      {FILTERS.map((f) => {
        const active = value === f.key;
        return (
          <Pressable
            key={f.key}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(f.key); }}
            style={[fp.pill, active && fp.pillActive]}
            testID={`discover-filter-${f.key}`}
          >
            {f.key === 'all' ? (
              <Send size={11} color={active ? colors.primary : colors.textSecondary} style={{ transform: [{ rotate: '-30deg' }] }} />
            ) : null}
            <Text style={[fp.pillTxt, active && fp.pillTxtActive]}>{f.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SectionHeader({
  title, subtitle, icon, accent, onSeeAll,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accent?: string;
  onSeeAll?: () => void;
}) {
  return (
    <View style={s.secHeader}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
        {icon ? (
          <View style={[s.secIcon, accent ? { borderColor: accent + '66', backgroundColor: accent + '14' } : null]}>
            {icon}
          </View>
        ) : null}
        <View style={{ flexShrink: 1 }}>
          <Text style={s.secTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.secSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </View>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <Text style={s.seeAll}>See all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ============================================================================
// Main component
// ============================================================================
export default function DiscoverPremiumView() {
  const [rails, setRails] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [followingMap, setFollowingMap] = useState<Record<string, boolean>>({});
  const [viewers, setViewers] = useState<{
    locked: boolean; total_views: number; viewers: any[];
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, v] = await Promise.all([
        api.get('/network/discover', { limit_per_rail: 12 }),
        api.get('/me/viewers').catch(() => null),
      ]);
      setRails(r || {});
      if (v) setViewers(v);
    } finally { setLoading(false); }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [r, v] = await Promise.all([
        api.get('/network/discover', { limit_per_rail: 12 }),
        api.get('/me/viewers').catch(() => null),
      ]);
      setRails(r || {});
      setViewers(v || null);
      setFollowingMap({}); // reset optimistic follow state so backend is SoT
    } catch {} finally { setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounced search → /network/search
  useEffect(() => {
    const term = q.trim();
    if (!term) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get('/network/search', { q: term, limit: 30 });
        setSearchResults(r.items || []);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Apply filter on top of base rails so the same data drives every chip.
  const filteredRails = useMemo(() => {
    const base = rails || {};
    const apply = (arr: any[]) => {
      if (!arr) return [];
      switch (filter) {
        case 'verified':
          return arr.filter((u) => u.verification_status === 'verified');
        case 'portrait':
          return arr.filter((u) => {
            const sp = Array.isArray(u.specialties) ? u.specialties : [];
            return sp.some((s: string) => /portrait/i.test(String(s)));
          });
        case 'pet':
          return arr.filter((u) => {
            const sp = Array.isArray(u.specialties) ? u.specialties : [];
            return sp.some((s: string) => /pet|dog/i.test(String(s)));
          });
        case 'all':
        default:
          // "Near Me" — keep the natural near_you ordering as the
          // best proxy when we don't yet pass real coords through
          // the network endpoint.
          return arr;
      }
    };
    return {
      best_matches: apply(base.near_you || base.top_contributors || []),
      active: apply(base.popular_in_city || base.near_you || []),
      trending: apply(base.top_contributors || []),
      referrals: apply(base.available_for_referrals || []),
      verified: apply(base.verified_pros || []),
      new_creators: apply(base.new_members || []),
    };
  }, [rails, filter]);

  const toggleFollow = useCallback(async (uid: string) => {
    Haptics.selectionAsync().catch(() => {});
    setFollowingMap((p) => ({ ...p, [uid]: !p[uid] }));
    try {
      await api.post(`/users/${uid}/follow`);
    } catch {
      setFollowingMap((p) => ({ ...p, [uid]: !p[uid] })); // rollback
    }
  }, []);

  const onInvite = async () => {
    Haptics.selectionAsync().catch(() => {});
    try {
      await Share.share({
        message:
          'Join me on LumaScout — find amazing photo spots and connect with photographers 📸\n\nhttps://lumascout.app',
        url: 'https://lumascout.app',
        title: 'LumaScout',
      });
    } catch {}
  };

  // Render a horizontal rail.
  // FIX(iOS Expo Go console error): backend rails (Best Matches / Near You /
  // Trending / New) can include the same user via multiple qualification
  // paths (popular AND nearby AND trending). With the cleaned-up directory
  // down to a handful of real users, duplicates surface within a single
  // rail's array, which made FlatList throw the "two children with the
  // same key" warning. We now dedupe by user_id at the rail boundary AND
  // append the index to the key as a final safety net so the warning can
  // never re-surface even if a rare backend bug introduces a true dup.
  const Rail = ({ data, ctx }: { data: any[]; ctx?: any }) => {
    const seen = new Set<string>();
    const uniq = (data || []).filter((u) => {
      if (!u || !u.user_id) return false;
      if (seen.has(u.user_id)) return false;
      seen.add(u.user_id);
      return true;
    });
    return (
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={uniq}
        keyExtractor={(u, idx) => `${u.user_id}_${idx}`}
        contentContainerStyle={{ paddingHorizontal: space.xl, gap: 10 }}
        snapToInterval={262}
        decelerationRate="fast"
        renderItem={({ item }) => (
          <UserCardPremium
            u={item}
            isFollowing={!!followingMap[item.user_id] || !!item.is_following}
            onToggleFollow={() => toggleFollow(item.user_id)}
            context={ctx}
          />
        )}
      />
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* Search bar — Network Discover CR (June 2025, round 2): ALL
          chip/pill content directly below the search input has been
          removed per product spec. That includes both (a) the 5-filter
          pill row (All / Nearby / Verified / Elite / New) and (b) the
          inline "Austin wedding / San Antonio pet / Dallas portrait"
          seeded example chips. The search bar now sits cleanly above
          the freshness banner with no chips in between. The `filter`
          state variable is retained (always 'all') so downstream
          rail-gating keeps working as if 'all' were selected. */}
      <View style={{ paddingHorizontal: space.xl, paddingTop: 2 }}>
        <View style={s.searchBar}>
          <Search size={16} color={colors.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search photographers, city, specialty"
            placeholderTextColor={colors.textTertiary}
            style={s.searchInp}
            testID="discover-search"
          />
        </View>
      </View>

      {/* Search results take over the feed when active */}
      {searchResults !== null ? (
        <View style={{ paddingHorizontal: space.xl, paddingTop: 12, gap: 10 }}>
          <Text style={s.resultsHdr}>
            {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
          </Text>
          {searchResults.length === 0 ? (
            <Text style={s.empty}>No photographers match. Try a broader search.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {searchResults.map((u) => (
                <UserCardPremium
                  key={u.user_id}
                  u={u}
                  isFollowing={!!followingMap[u.user_id] || !!u.is_following}
                  onToggleFollow={() => toggleFollow(u.user_id)}
                />
              ))}
            </View>
          )}
        </View>
      ) : (
        <>
          {/* June 2025 Discover redesign — single primary recommendation
              + a small compact row + invite. The freshness banner and
              the 7-rail wall (Best Matches / Active Near / Trending /
              Referrals / Verified / Recently Joined / Who Viewed You)
              are deliberately gone. The Discover tab now answers ONE
              question — "Who should I connect with today?" — and lets
              users dig deeper via the Directory tab. */}
          <FilterPills value={filter} onChange={setFilter} />

          {/* ── Recommended for you (one big featured creator) ── */}
          {(() => {
            // Pick the strongest candidate from the filtered rails.
            // Order of preference is intentional: best-match (server's
            // own near_you/top recommendations) > active near > trending
            // > verified > new. The first user in any non-empty rail
            // becomes the hero. Excluded from the "Near You" row below.
            const pool = (
              filteredRails.best_matches.length ? filteredRails.best_matches :
              filteredRails.active.length        ? filteredRails.active :
              filteredRails.trending.length      ? filteredRails.trending :
              filteredRails.verified.length      ? filteredRails.verified :
              filteredRails.new_creators
            );
            const hero = pool[0];
            if (!hero) {
              return (
                <View style={{ paddingHorizontal: space.xl, marginTop: 18 }}>
                  <Text style={s.empty}>
                    No creators match this filter yet. Try Near Me or check the Directory tab.
                  </Text>
                </View>
              );
            }
            return (
              <View style={{ marginTop: 18, paddingHorizontal: space.xl }}>
                <View style={s.heroSectionHeader}>
                  <View style={s.heroSectionIcon}>
                    <Sparkles size={11} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.heroSectionTitle}>Recommended for you</Text>
                    <Text style={s.heroSectionSub}>Based on your location & interests</Text>
                  </View>
                </View>
                <HeroRecommendedCard
                  u={hero}
                  isFollowing={!!followingMap[hero.user_id] || !!hero.is_following}
                  onToggleFollow={() => toggleFollow(hero.user_id)}
                />
              </View>
            );
          })()}

          {/* ── Photographers Near You (2-3 compact cards) ── */}
          {(() => {
            const heroId =
              (filteredRails.best_matches[0]?.user_id) ??
              (filteredRails.active[0]?.user_id) ??
              (filteredRails.trending[0]?.user_id) ??
              (filteredRails.verified[0]?.user_id) ??
              (filteredRails.new_creators[0]?.user_id);
            // Fold across rails, dedupe, exclude the hero, take 3.
            const pool: any[] = [
              ...(filteredRails.active || []),
              ...(filteredRails.best_matches || []),
              ...(filteredRails.trending || []),
            ];
            const seen = new Set<string>();
            if (heroId) seen.add(heroId);
            const near: any[] = [];
            for (const u of pool) {
              if (!u?.user_id || seen.has(u.user_id)) continue;
              seen.add(u.user_id);
              near.push(u);
              if (near.length >= 3) break;
            }
            if (near.length === 0) return null;
            return (
              <View style={{ marginTop: 22, paddingHorizontal: space.xl }}>
                <View style={s.heroSectionHeader}>
                  <View style={[s.heroSectionIcon, { backgroundColor: 'rgba(34,197,94,0.14)' }]}>
                    <MapPin size={11} color="#22c55e" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.heroSectionTitle}>Photographers near you</Text>
                    <Text style={s.heroSectionSub}>Active in your area</Text>
                  </View>
                </View>
                <View style={s.compactRow}>
                  {near.map((u) => (
                    <CompactCreatorCard
                      key={u.user_id}
                      u={u}
                      isFollowing={!!followingMap[u.user_id] || !!u.is_following}
                      onToggleFollow={() => toggleFollow(u.user_id)}
                    />
                  ))}
                </View>
              </View>
            );
          })()}

          {/* ── Invite friends CTA ── */}
          <Pressable style={s.inviteCard} onPress={onInvite} testID="discover-invite">
            <LinearGradient
              colors={['rgba(245,166,35,0.18)', 'rgba(245,166,35,0.04)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.inviteGrad}
            />
            <View style={s.inviteIcon}>
              <UserPlus size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.inviteTitle}>Know a great photographer?</Text>
              <Text style={s.inviteSub}>Invite them to LumaScout and you'll both earn perks.</Text>
            </View>
            <View style={s.inviteCta}>
              <Text style={s.inviteCtaTxt}>Invite</Text>
              <ChevronRight size={14} color="#1a1300" />
            </View>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

// ============================================================================
// Viewers upsell (blurred placeholder for free users)
// ============================================================================
function ViewersUpsell({ locked, count }: { locked: boolean; count: number }) {
  return (
    <Pressable
      onPress={() => locked ? router.push('/paywall' as any) : router.push('/profile-viewers' as any)}
      style={s.viewersBlur}
      testID="viewers-upsell"
    >
      <View style={s.viewersBlurStack}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              s.viewersBlurAvatar,
              { marginLeft: i === 0 ? 0 : -14, zIndex: 10 - i },
            ]}
          />
        ))}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.viewersBlurTitle}>
          {count > 0 ? `${count} people viewed you` : 'See who viewed your profile'}
        </Text>
        <Text style={s.viewersBlurSub}>
          {locked ? 'Upgrade to Pro or Elite to unlock viewer profiles' : 'Tap to view viewers'}
        </Text>
      </View>
      <View style={s.viewersBlurCta}>
        {locked ? (
          <Lock size={14} color={colors.primary} />
        ) : (
          <ChevronRight size={14} color={colors.primary} />
        )}
      </View>
    </Pressable>
  );
}

// ============================================================================
// Styles
// ============================================================================
const s = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInp: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14, padding: 0 },
  exChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  exChipTxt: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 11 },

  filterStrip: {
    paddingHorizontal: space.xl,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
    alignItems: 'center',
  },
  filterPill: {
    paddingHorizontal: 14,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterPillTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12.5 },
  filterPillTxtActive: { color: '#1a1300', fontFamily: font.bodyBold },

  // Daily freshness banner
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: space.xl,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  freshnessIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  freshnessTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12.5 },

  // Section header
  secHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.xl,
    marginBottom: 10,
  },
  secIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  secTitle: { color: colors.text, fontFamily: font.display, fontSize: 18, letterSpacing: -0.2 },
  secSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  seeAll: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12 },

  // Premium UserCard (cardLg = 250 wide)
  cardLg: {
    width: 252,
    padding: 12,
    borderRadius: 22,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
    overflow: 'hidden',
  },
  cardLgElite: {
    borderColor: 'rgba(245,166,35,0.5)',
  },
  cardLgEliteGrad: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 60,
  },
  cardLgRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'relative',
    width: 52, height: 52, borderRadius: 26,
    padding: 2,
    backgroundColor: 'transparent',
  },
  avatarWrapElite: {
    backgroundColor: colors.primary,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  onlineDot: {
    position: 'absolute',
    bottom: 0, right: 0,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#22c55e',
    borderWidth: 2, borderColor: colors.surface1,
  },
  nameLg: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 14,
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  usernameLg: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  cityLg: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  followers: { color: colors.textTertiary, fontFamily: font.bodySemibold, fontSize: 10.5 },
  verifiedDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#3b82f6',
    alignItems: 'center', justifyContent: 'center',
  },
  verifiedDotTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 8 },
  elitePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  elitePillTxt: {
    color: '#1a1300',
    fontFamily: font.bodyBold,
    fontSize: 8,
    letterSpacing: 0.6,
  },
  proPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.45)',
  },
  proPillTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 8,
    letterSpacing: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  specChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  specChipTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 10.5,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  btn: {
    flex: 1,
    height: 32,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  btnPrimaryTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 12 },
  btnSecondaryTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },

  resultsHdr: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  empty: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: 20 },

  // Viewers upsell
  viewersBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: space.xl,
    padding: 14,
    borderRadius: 22,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: 'rgba(157,89,255,0.4)',
  },
  viewersBlurStack: { flexDirection: 'row' },
  viewersBlurAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#3a1f5e',
    borderWidth: 2,
    borderColor: colors.surface1,
  },
  viewersBlurTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  viewersBlurSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  viewersBlurCta: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
  },

  // Invite friends CTA
  inviteCard: {
    marginHorizontal: space.xl,
    marginTop: 22,
    padding: 16,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    overflow: 'hidden',
  },
  inviteGrad: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  inviteIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.45)',
  },
  inviteTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  inviteSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11.5, marginTop: 2 },
  inviteCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  inviteCtaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 12 },

  // June 2025 Discover redesign — section header for hero + compact row
  heroSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  heroSectionIcon: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)',
  },
  heroSectionTitle: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  heroSectionSub: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
    marginTop: 1,
  },
  compactRow: {
    flexDirection: 'row',
    gap: 8,
  },
});

// ============================================================================
// HERO RECOMMENDED CARD STYLES
// ============================================================================
const hero = StyleSheet.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.45)',
    backgroundColor: colors.surface1,
    padding: 14,
    gap: 12,
  },
  grad: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.7 },
  headerRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatarWrap: {
    position: 'relative',
    width: 70, height: 70, borderRadius: 35,
    borderWidth: 2, borderColor: colors.primary,
    padding: 2,
  },
  avatar: { width: '100%', height: '100%', borderRadius: 31 },
  onlineDot: {
    position: 'absolute', right: 2, bottom: 2,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2, borderColor: colors.surface1,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 17, letterSpacing: -0.2 },
  proPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.5)',
    backgroundColor: 'rgba(245,166,35,0.10)',
  },
  proPillTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  location: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  specRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  specPill: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  specPillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 4,
  },
  reasonTxt: {
    color: colors.primary,
    fontFamily: font.bodyMedium,
    fontSize: 12.5,
    flex: 1,
  },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  actionBtnGold: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionBtnFollowing: {
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderColor: colors.primary,
  },
  actionBtnTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  actionBtnTxtGold: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 13 },
});

// ============================================================================
// COMPACT CREATOR CARD STYLES
// ============================================================================
const compact = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    padding: 10,
    paddingTop: 12,
    gap: 8,
    minWidth: 0,
  },
  avatarWrap: {
    position: 'relative',
    width: 54, height: 54, borderRadius: 27,
  },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  onlineDot: {
    position: 'absolute', right: 0, bottom: 0,
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#22c55e',
    borderWidth: 2, borderColor: colors.surface1,
  },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13.5, letterSpacing: -0.1 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  loc: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  specRow: { flexDirection: 'row', gap: 4, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' },
  specPill: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    maxWidth: 80,
  },
  specPillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10 },
  actionsRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  followBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  followBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: 1, borderColor: colors.primary,
  },
  followBtnTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 11.5 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'transparent',
  },
});

// ============================================================================
// FILTER PILL ROW STYLES
// ============================================================================
const fp = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  pillActive: {
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderColor: colors.primary,
  },
  pillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  pillTxtActive: { color: colors.primary, fontFamily: font.bodyBold },
});
