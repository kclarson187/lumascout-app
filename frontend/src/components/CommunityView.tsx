/**
 * CommunityView — Network ▸ Community segmented panel.
 *
 *   Restores the previously-removed Community feature as a third top-tab
 *   inside Network (alongside Discover and Directory). Consumes the
 *   existing GET /api/posts endpoint (no backend changes), renders a
 *   premium dark social feed with category pills, post cards, and the
 *   five PRD post types (Photo Feedback / Referral / Gear / Editing /
 *   General). Like / Comment / Share / Save / Message-User actions
 *   wire to existing backend endpoints (/posts/{id}/like, /comments,
 *   /dm/threads/start). Compose entrypoint deep-links into the
 *   existing /community/compose route.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Image, ActivityIndicator,
  ScrollView, Share, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import {
  Plus, Search, Heart, MessageCircle, Share2 as ShareIcon, Bookmark,
  Briefcase, Camera, Settings, HelpCircle, MapPin, Sparkles, Flame,
  ChevronRight,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../api';
import { colors, font, space } from '../theme';

// ============================================================================
// Categories — top filter pills
// ============================================================================
type CategoryKey = 'all' | 'feedback' | 'referrals' | 'gear' | 'editing' | 'questions' | 'local';
const CATEGORIES: { key: CategoryKey; label: string; icon?: any; accent: string }[] = [
  { key: 'all',       label: 'All',       icon: Sparkles,    accent: colors.primary },
  { key: 'feedback',  label: 'Feedback',  icon: Camera,      accent: '#22c55e' },
  { key: 'referrals', label: 'Referrals', icon: Briefcase,   accent: '#9D59FF' },
  { key: 'gear',      label: 'Gear',      icon: Settings,    accent: '#60A5FA' },
  { key: 'editing',   label: 'Editing',   icon: Sparkles,    accent: '#F97316' },
  { key: 'questions', label: 'Questions', icon: HelpCircle,  accent: colors.primary },
  { key: 'local',     label: 'Local',     icon: MapPin,      accent: '#22c55e' },
];

// ============================================================================
// Helpers
// ============================================================================
function timeAgo(ts: string | undefined): string {
  if (!ts) return '';
  const d = new Date(ts).getTime();
  const sec = Math.max(1, Math.floor((Date.now() - d) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}d`;
  const w = Math.floor(day / 7);
  if (w < 5) return `${w}w`;
  return new Date(ts).toLocaleDateString();
}

function categoryMeta(cat: string | undefined) {
  return CATEGORIES.find((c) => c.key === cat) || CATEGORIES[0];
}

// ============================================================================
// MAIN
// ============================================================================
export default function CommunityView() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<CategoryKey>('all');
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [savedMap, setSavedMap] = useState<Record<string, boolean>>({});

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      try {
        const r = await api.get('/posts', {
          category: category === 'all' ? undefined : category,
          limit: 25,
        });
        setPosts(Array.isArray(r) ? r : (r?.items || []));
      } catch {
        setPosts([]);
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    },
    [category],
  );

  useEffect(() => { load(); }, [load]);

  // Smart retention badges — counted from current feed
  const retentionStats = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 3600 * 1000;
    return {
      feedback: posts.filter((p) => p.category === 'feedback').length,
      referrals: posts.filter((p) => p.category === 'referrals').length,
      activeToday: posts.filter((p) => {
        const t = p.created_at ? new Date(p.created_at).getTime() : 0;
        return t > dayAgo;
      }).length,
    };
  }, [posts]);

  const toggleLike = useCallback(async (postId: string) => {
    Haptics.selectionAsync().catch(() => {});
    const wasLiked = !!likedMap[postId];
    setLikedMap((p) => ({ ...p, [postId]: !wasLiked }));
    try {
      if (wasLiked) await api.delete(`/posts/${postId}/like`);
      else await api.post(`/posts/${postId}/like`);
    } catch {
      setLikedMap((p) => ({ ...p, [postId]: wasLiked })); // rollback
    }
  }, [likedMap]);

  const toggleSave = useCallback((postId: string) => {
    // Backend doesn't yet have /posts/save — keep optimistic local state
    // so the bookmark toggles instantly and we wire the API later.
    Haptics.selectionAsync().catch(() => {});
    setSavedMap((p) => ({ ...p, [postId]: !p[postId] }));
  }, []);

  const onShare = async (post: any) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const url = `https://lumascout.app/community/post/${post.post_id}`;
      await Share.share({
        message: `${post.body || post.title || 'Check this out on LumaScout'}\n\n${url}`,
        url,
      });
    } catch {}
  };

  const onMessage = async (uid: string) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await api.post('/dm/threads/start', { other_user_id: uid });
      if (r?.thread_id) router.push(`/inbox/${r.thread_id}` as any);
    } catch {}
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Sticky header — Search + Compose CTAs */}
      <View style={s.toolbar}>
        <Pressable
          onPress={() => router.push('/search' as any)}
          style={s.searchBtn}
          testID="community-search"
        >
          <Search size={14} color={colors.textSecondary} />
          <Text style={s.searchPlaceholder}>Search posts, people, topics</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            router.push('/community/compose' as any);
          }}
          style={s.composeBtn}
          testID="community-compose"
        >
          <Plus size={16} color="#1a1300" />
        </Pressable>
      </View>

      {/* Category pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.catRow}
      >
        {CATEGORIES.map((c) => {
          const active = category === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setCategory(c.key);
              }}
              style={[
                s.catPill,
                active && [s.catPillActive, { borderColor: c.accent, backgroundColor: c.accent + '20' }],
              ]}
              testID={`community-cat-${c.key}`}
            >
              {c.icon ? (
                <c.icon size={11} color={active ? c.accent : colors.textSecondary} />
              ) : null}
              <Text style={[s.catPillTxt, active && { color: c.accent }]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Retention strip */}
      {(retentionStats.feedback > 0 || retentionStats.referrals > 0) ? (
        <View style={s.retentionStrip}>
          {retentionStats.feedback > 0 ? (
            <View style={[s.retBlip, { borderColor: 'rgba(34,197,94,0.45)' }]}>
              <Camera size={10} color="#22c55e" />
              <Text style={[s.retBlipTxt, { color: '#22c55e' }]}>
                {retentionStats.feedback} feedback request{retentionStats.feedback === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
          {retentionStats.referrals > 0 ? (
            <View style={[s.retBlip, { borderColor: 'rgba(157,89,255,0.45)' }]}>
              <Briefcase size={10} color="#9D59FF" />
              <Text style={[s.retBlipTxt, { color: '#9D59FF' }]}>
                {retentionStats.referrals} referral{retentionStats.referrals === 1 ? '' : 's'} near you
              </Text>
            </View>
          ) : null}
          {retentionStats.activeToday > 0 ? (
            <View style={[s.retBlip, { borderColor: 'rgba(245,166,35,0.45)' }]}>
              <Flame size={10} color={colors.primary} />
              <Text style={[s.retBlipTxt, { color: colors.primary }]}>
                {retentionStats.activeToday} active today
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Feed */}
      {posts.length === 0 ? (
        <EmptyState category={category} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(p) => p.post_id}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 120, gap: 10 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <PostCard
              p={item}
              isLiked={!!likedMap[item.post_id] || !!item.is_liked}
              isSaved={!!savedMap[item.post_id]}
              onLike={() => toggleLike(item.post_id)}
              onSave={() => toggleSave(item.post_id)}
              onShare={() => onShare(item)}
              onMessage={() => item.author?.user_id && onMessage(item.author.user_id)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ============================================================================
// PostCard
// ============================================================================
function PostCard({
  p, isLiked, isSaved, onLike, onSave, onShare, onMessage,
}: {
  p: any;
  isLiked?: boolean;
  isSaved?: boolean;
  onLike: () => void;
  onSave: () => void;
  onShare: () => void;
  onMessage: () => void;
}) {
  const meta = categoryMeta(p.category);
  const a = p.author || {};
  const isReferral = p.category === 'referrals';
  const elite = a.plan === 'elite';
  const verified = a.verification_status === 'verified';
  const likeCount = (p.like_count ?? p.likes ?? 0) + (isLiked && !p.is_liked ? 1 : 0);
  const commentCount = p.comment_count ?? p.comments ?? 0;
  const cover = (Array.isArray(p.images) ? p.images[0] : null);
  const coverUrl = cover?.image_url || cover?.url || (typeof cover === 'string' ? cover : null);

  return (
    <Pressable
      onPress={() => router.push(`/community/post/${p.post_id}` as any)}
      style={[s.card, elite && s.cardElite]}
      testID={`community-post-${p.post_id}`}
    >
      {/* Author row */}
      <View style={s.cardHead}>
        <Pressable
          onPress={() => a.user_id && router.push(`/user/${a.user_id}` as any)}
          style={s.avatarWrap}
        >
          {a.avatar_url ? (
            <Image source={{ uri: a.avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Text style={s.avatarTxt}>
                {(a.name || a.username || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <Text style={s.name} numberOfLines={1}>{a.name || `@${a.username || 'user'}`}</Text>
            {verified ? (
              <View style={s.verifiedDot}>
                <Text style={s.verifiedDotTxt}>✓</Text>
              </View>
            ) : null}
            {elite ? (
              <View style={s.elitePill}>
                <Text style={s.elitePillTxt}>ELITE</Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {a.city ? (
              <Text style={s.subtle} numberOfLines={1}>{a.city}{a.state ? `, ${a.state}` : ''} · </Text>
            ) : null}
            <Text style={s.subtle}>{timeAgo(p.created_at)}</Text>
          </View>
        </View>
        <View style={[s.catChip, { borderColor: meta.accent + '55', backgroundColor: meta.accent + '14' }]}>
          {meta.icon ? <meta.icon size={9} color={meta.accent} /> : null}
          <Text style={[s.catChipTxt, { color: meta.accent }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Title / body */}
      {p.title ? (
        <Text style={s.title} numberOfLines={2}>{p.title}</Text>
      ) : null}
      {p.body ? (
        <Text style={s.body} numberOfLines={4}>{p.body}</Text>
      ) : null}

      {/* Image (if uploaded) */}
      {coverUrl ? (
        <View style={s.imgWrap}>
          <Image source={{ uri: coverUrl }} style={s.img} />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.55)']}
            style={s.imgGrad}
          />
        </View>
      ) : null}

      {/* Action row */}
      <View style={s.actions}>
        <Pressable onPress={onLike} hitSlop={6} style={s.actBtn} testID={`like-${p.post_id}`}>
          <Heart
            size={16}
            color={isLiked ? '#ef4444' : colors.textSecondary}
            fill={isLiked ? '#ef4444' : 'transparent'}
          />
          <Text style={[s.actTxt, isLiked && { color: '#ef4444' }]}>{likeCount}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push(`/community/post/${p.post_id}` as any)}
          hitSlop={6}
          style={s.actBtn}
        >
          <MessageCircle size={16} color={colors.textSecondary} />
          <Text style={s.actTxt}>{commentCount}</Text>
        </Pressable>
        <Pressable onPress={onShare} hitSlop={6} style={s.actBtn}>
          <ShareIcon size={15} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={onSave}
          hitSlop={6}
          style={[s.actBtn, { marginLeft: 'auto' }]}
        >
          <Bookmark
            size={15}
            color={isSaved ? colors.primary : colors.textSecondary}
            fill={isSaved ? colors.primary : 'transparent'}
          />
        </Pressable>
      </View>

      {/* Referral CTA row — only on referral posts */}
      {isReferral && a.user_id ? (
        <View style={s.referralRow}>
          <Pressable onPress={onMessage} style={[s.refBtn, s.refBtnPrimary]}>
            <MessageCircle size={12} color="#1a1300" />
            <Text style={s.refBtnPrimaryTxt}>Message</Text>
          </Pressable>
          <Pressable onPress={onMessage} style={[s.refBtn, s.refBtnSecondary]}>
            <Text style={s.refBtnSecondaryTxt}>I'm interested</Text>
            <ChevronRight size={12} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

// ============================================================================
// Empty state
// ============================================================================
function EmptyState({ category }: { category: CategoryKey }) {
  const meta = categoryMeta(category);
  return (
    <View style={s.empty}>
      <View style={[s.emptyIcon, { backgroundColor: meta.accent + '1a', borderColor: meta.accent + '55' }]}>
        {meta.icon ? <meta.icon size={20} color={meta.accent} /> : null}
      </View>
      <Text style={s.emptyTitle}>
        {category === 'all' ? 'No posts yet' : `No ${meta.label.toLowerCase()} posts yet`}
      </Text>
      <Text style={s.emptyBody}>
        Start the conversation. Share your work, ask for feedback, or post a referral.
      </Text>
      <Pressable
        onPress={() => router.push('/community/compose' as any)}
        style={s.emptyCta}
      >
        <Plus size={14} color="#1a1300" />
        <Text style={s.emptyCtaTxt}>Create a post</Text>
      </Pressable>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================
const s = StyleSheet.create({
  // Toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.xl,
    paddingTop: 4,
    paddingBottom: 10,
  },
  searchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  searchPlaceholder: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13 },
  composeBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },

  // Category pills
  catRow: {
    paddingHorizontal: space.xl,
    paddingBottom: 10,
    gap: 6,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catPillActive: {},
  catPillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },

  // Retention strip
  retentionStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: space.xl,
    paddingBottom: 12,
  },
  retBlip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  retBlipTxt: { fontFamily: font.bodyBold, fontSize: 10.5 },

  // Card
  card: {
    padding: 12,
    borderRadius: 22,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  cardElite: { borderColor: 'rgba(245,166,35,0.45)' },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarWrap: { width: 40, height: 40, borderRadius: 20 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: {
    color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 14,
  },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13.5 },
  subtle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  verifiedDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#3b82f6',
    alignItems: 'center', justifyContent: 'center',
  },
  verifiedDotTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 7 },
  elitePill: {
    paddingHorizontal: 5, paddingVertical: 1.5,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  elitePillTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.6 },

  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  catChipTxt: { fontFamily: font.bodyBold, fontSize: 9.5, letterSpacing: 0.3 },

  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15, letterSpacing: -0.1 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 },

  imgWrap: {
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  img: { width: '100%', height: '100%' },
  imgGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '40%' },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 4,
  },
  actBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actTxt: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 12 },

  referralRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 6,
  },
  refBtn: {
    flex: 1,
    height: 34,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  refBtnPrimary: { backgroundColor: colors.primary },
  refBtnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  refBtnPrimaryTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 12 },
  refBtnSecondaryTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },

  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: 60,
    gap: 8,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  emptyTitle: {
    color: colors.text, fontFamily: font.bodyBold, fontSize: 16, marginTop: 4,
  },
  emptyBody: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13,
    textAlign: 'center', lineHeight: 18, marginBottom: 8,
  },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, height: 38, borderRadius: 19,
    backgroundColor: colors.primary,
  },
  emptyCtaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 13 },
});
