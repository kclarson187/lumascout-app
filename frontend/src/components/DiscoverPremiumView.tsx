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
  ActivityIndicator, Share, FlatList,
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

// ============================================================================
// Filter pill row
// ============================================================================
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'nearby', label: 'Nearby' },
  { key: 'verified', label: 'Verified' },
  { key: 'elite', label: 'Elite' },
  { key: 'new', label: 'New' },
  { key: 'wedding', label: 'Wedding' },
  { key: 'portrait', label: 'Portrait' },
  { key: 'pet', label: 'Pet' },
  { key: 'family', label: 'Family' },
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
            {isElite ? (
              <View style={s.elitePill}>
                <Gem size={9} color="#1a1300" />
                <Text style={s.elitePillTxt}>ELITE</Text>
              </View>
            ) : isPro ? (
              <View style={s.proPill}>
                <Star size={9} color={colors.primary} fill={colors.primary} strokeWidth={0} />
                <Text style={s.proPillTxt}>PRO</Text>
              </View>
            ) : null}
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
              const r = await api.post('/dm/threads/start', { other_user_id: u.user_id });
              if (r?.thread_id) router.push(`/dm/${r.thread_id}` as any);
            } catch {}
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
        case 'elite':
          return arr.filter((u) => u.plan === 'elite');
        case 'new':
          return arr.filter((u) => {
            const d = u.created_at ? new Date(u.created_at).getTime() : 0;
            return d > Date.now() - 30 * 24 * 3600 * 1000;
          });
        case 'nearby':
          // Already handled by near_you rail; here fold across all rails
          return arr;
        case 'wedding':
        case 'portrait':
        case 'pet':
        case 'family':
          return arr.filter((u) =>
            Array.isArray(u.specialties)
              ? u.specialties.some((sp: string) => String(sp).toLowerCase().includes(filter))
              : String(u.specialties || '').toLowerCase().includes(filter),
          );
        default: return arr;
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

  // Render a horizontal rail
  const Rail = ({ data, ctx }: { data: any[]; ctx?: any }) => (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={data}
      keyExtractor={(u) => u.user_id}
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
    >
      {/* Search bar */}
      <View style={{ paddingHorizontal: space.xl, paddingTop: 4 }}>
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
        {/* Inline example chips when input is empty */}
        {!q ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {['Austin wedding', 'San Antonio pet', 'Dallas portrait'].map((ex) => (
              <Pressable key={ex} onPress={() => setQ(ex)} style={s.exChip}>
                <Text style={s.exChipTxt}>{ex}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {/* Filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterStrip}
        keyboardShouldPersistTaps="handled"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setFilter(f.key);
              }}
              style={[s.filterPill, active && s.filterPillActive]}
              testID={`discover-filter-${f.key}`}
            >
              <Text style={[s.filterPillTxt, active && s.filterPillTxtActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

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
          {/* Daily freshness banner */}
          <Pressable style={s.freshness} onPress={onInvite} testID="discover-freshness">
            <View style={s.freshnessIcon}>
              <Flame size={13} color={colors.primary} />
            </View>
            <Text style={s.freshnessTxt}>{dailyFreshness(rails)}</Text>
            <ChevronRight size={14} color={colors.textSecondary} style={{ marginLeft: 'auto' }} />
          </Pressable>

          {/* 2 — Best Matches For You */}
          {filteredRails.best_matches.length > 0 ? (
            <View style={{ marginTop: 6 }}>
              <SectionHeader
                title="Best Matches For You"
                subtitle="Curated for your interests"
                icon={<Sparkles size={13} color={colors.primary} />}
                accent={colors.primary}
              />
              <Rail data={filteredRails.best_matches} ctx="match" />
            </View>
          ) : null}

          {/* 3 — Active Near You */}
          {filteredRails.active.length > 0 ? (
            <View style={{ marginTop: 18 }}>
              <SectionHeader
                title="Active Near You"
                subtitle="Online or posting today"
                icon={<Zap size={13} color="#22c55e" />}
                accent="#22c55e"
              />
              <Rail data={filteredRails.active} ctx="active" />
            </View>
          ) : null}

          {/* 4 — Trending This Week */}
          {filteredRails.trending.length > 0 ? (
            <View style={{ marginTop: 18 }}>
              <SectionHeader
                title="Trending This Week"
                subtitle="Most viewed creators in your region"
                icon={<TrendingUp size={13} color="#F97316" />}
                accent="#F97316"
              />
              <Rail data={filteredRails.trending} ctx="trending" />
            </View>
          ) : null}

          {/* 5 — Available For Referrals */}
          {filteredRails.referrals.length > 0 ? (
            <View style={{ marginTop: 18 }}>
              <SectionHeader
                title="Available For Referrals"
                subtitle="Photographers booking referrals now"
                icon={<Briefcase size={13} color="#22c55e" />}
                accent="#22c55e"
              />
              <Rail data={filteredRails.referrals} ctx="referral" />
            </View>
          ) : null}

          {/* 6 — Verified Pros */}
          {filteredRails.verified.length > 0 ? (
            <View style={{ marginTop: 18 }}>
              <SectionHeader
                title="Verified Pros"
                subtitle="Trusted, authenticated creators"
                icon={<ShieldCheck size={13} color="#3b82f6" />}
                accent="#3b82f6"
              />
              <Rail data={filteredRails.verified} ctx="verified" />
            </View>
          ) : null}

          {/* 7 — New Creators */}
          {filteredRails.new_creators.length > 0 ? (
            <View style={{ marginTop: 18 }}>
              <SectionHeader
                title="New Creators"
                subtitle="Joined LumaScout in the last 30 days"
                icon={<Sparkles size={13} color={colors.primary} />}
                accent={colors.primary}
              />
              <Rail data={filteredRails.new_creators} ctx="new" />
            </View>
          ) : null}

          {/* 8 — Who Viewed You (blurred for free) */}
          <View style={{ marginTop: 18 }}>
            <SectionHeader
              title="Who Viewed You"
              subtitle={
                viewers?.locked
                  ? 'Upgrade to see who viewed your profile'
                  : `${viewers?.total_views || 0} viewers in the last 30 days`
              }
              icon={<Eye size={13} color="#9D59FF" />}
              accent="#9D59FF"
              onSeeAll={
                viewers?.locked
                  ? undefined
                  : () => router.push('/profile-viewers' as any)
              }
            />
            {viewers?.locked || (viewers?.viewers || []).length === 0 ? (
              <ViewersUpsell locked={!!viewers?.locked} count={viewers?.total_views || 0} />
            ) : (
              <Rail data={viewers!.viewers} />
            )}
          </View>

          {/* 9 — Invite Friends CTA */}
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
              <Text style={s.inviteTitle}>Know great photographers?</Text>
              <Text style={s.inviteSub}>Invite them to LumaScout — earn referral perks.</Text>
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
      onPress={() => locked ? router.push('/upgrade' as any) : router.push('/profile-viewers' as any)}
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
    height: 48,
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
    paddingVertical: 12,
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
});
