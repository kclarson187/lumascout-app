import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Plus, MessageCircle, Heart, Users, Sparkles, Coffee, Camera, HandHeart, Wrench, Eye, BookOpen, Briefcase, Star, GraduationCap, MapPin, Clock, Flame, PenLine, Lightbulb } from 'lucide-react-native';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import VerifiedBadge from '../src/components/VerifiedBadge';
import UserBadge from '../src/components/UserBadge';
import PollCard from '../src/components/PollCard';
import ScoutAIAvatar from '../src/components/ScoutAIAvatar';

// Small helper so every card shows a humanized relative timestamp instead of
// "4/20/2026" which is useless for feed scanning.
function timeAgo(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const TABS = [
  { k: 'all',       label: 'All' },
  { k: 'win',       label: 'Wins' },
  { k: 'question',  label: 'Q&A' },
  { k: 'tip',       label: 'Tips' },
  { k: 'referral',  label: 'Referrals' },
  { k: 'collab',    label: 'Collab' },
  { k: 'meetup',    label: 'Meetups' },
  { k: 'critique',  label: 'Critique' },
  { k: 'bts',       label: 'BTS' },
  { k: 'intro',     label: 'Intros' },
];

const CATEGORY_COLORS: Record<string, string> = {
  win: colors.success,
  question: colors.info,
  tip: colors.primary,
  gear: colors.textSecondary,
  critique: colors.warning,
  bts: colors.primary,
  referral: colors.secondary,
  collab: colors.info,
  meetup: colors.success,
  intro: colors.primary,
};

const CATEGORY_ICONS: Record<string, any> = {
  win: Star, question: BookOpen, tip: Sparkles, gear: Wrench,
  critique: Eye, bts: Camera, referral: HandHeart, collab: Users,
  meetup: Coffee, intro: MessageCircle,
};

import ScreenErrorBoundary from '../src/components/ScreenErrorBoundary';

export default function Community() {
  return (
    <ScreenErrorBoundary label="Community">
      <CommunityImpl />
    </ScreenErrorBoundary>
  );
}

function CommunityImpl() {
  const { cat } = useLocalSearchParams<{ cat?: string }>();
  const { user } = useAuth();
  const [active, setActive] = useState(cat || 'all');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/posts', active === 'all' ? {} : { category: active });
      setItems(r?.items || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, [active]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Community</Text>
          <Text style={styles.title} numberOfLines={1}>Photographers</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/groups')} style={styles.iconBtn} testID="community-groups">
          <Users size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/mentors')} style={styles.iconBtn} testID="community-mentors">
          <GraduationCap size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/inbox')} style={styles.iconBtn} testID="community-messages">
          <MessageCircle size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/community/compose')} style={styles.composeBtn} testID="community-compose">
          <Plus size={18} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabStripScroll}
        contentContainerStyle={styles.tabStrip}
      >
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.k}
            onPress={() => setActive(t.k)}
            style={[styles.tab, active === t.k && styles.tabActive]}
            testID={`community-tab-${t.k}`}
          >
            <Text style={[styles.tabTxt, active === t.k && styles.tabTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.xl, gap: 10, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {/* Composer prompt — always visible nudge to post (PRD #7).
              Tappable preview input with viewer's avatar. */}
          {user && (
            <TouchableOpacity
              onPress={() => router.push('/community/compose')}
              style={styles.composerPrompt}
              testID="community-composer-prompt"
            >
              {user.avatar_image_url || user.avatar_url
                ? <Image source={{ uri: user.avatar_image_url || user.avatar_url }} style={styles.composerAvatar} />
                : <View style={[styles.composerAvatar, { backgroundColor: colors.surface2 }]} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.composerHint} numberOfLines={1}>
                  Share a win, ask a question, drop a tip…
                </Text>
              </View>
              <View style={styles.composerCta}>
                <PenLine size={14} color={colors.textInverse} />
                <Text style={styles.composerCtaTxt}>Post</Text>
              </View>
            </TouchableOpacity>
          )}

          {items.length === 0 && (
            <View style={styles.emptyWrap}>
              <Users size={28} color={colors.primary} />
              <Text style={styles.emptyTitle}>Be the first</Text>
              <Text style={styles.emptyBody}>
                The feed is quiet. Share a win, ask a question, or post a referral — photographers will see it.
              </Text>
              <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/community/compose')}>
                <Plus size={14} color={colors.textInverse} />
                <Text style={styles.emptyBtnTxt}>Start a post</Text>
              </TouchableOpacity>
            </View>
          )}
          {items.map((p) => <PostCard key={p.post_id} post={p} onLike={load} meId={user?.user_id} />)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PostCard({ post, onLike, meId }: { post: any; onLike: () => void; meId?: string }) {
  const [liked, setLiked] = useState(!!post.liked_by_me);
  const [likeCount, setLikeCount] = useState(post.like_count || 0);
  const [poll, setPoll] = useState<any>(post.poll || null);
  const Cat = CATEGORY_ICONS[post.category] || BookOpen;
  const color = CATEGORY_COLORS[post.category] || colors.primary;

  // PRD #10: typed reactions (Win/Tip) live alongside Heart like.
  // Optimistic toggle pattern mirrored from toggleLike — rollback on failure.
  const initialReactions: string[] = Array.isArray(post.my_reactions) ? post.my_reactions : [];
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set(initialReactions));
  const [reactionCounts, setReactionCounts] = useState<{ win: number; tip: number }>({
    win: Number(post.reaction_counts?.win || 0),
    tip: Number(post.reaction_counts?.tip || 0),
  });
  const toggleReaction = async (kind: 'win' | 'tip') => {
    const was = myReactions.has(kind);
    const nextSet = new Set(myReactions);
    if (was) nextSet.delete(kind); else nextSet.add(kind);
    setMyReactions(nextSet);
    setReactionCounts((c) => ({ ...c, [kind]: Math.max(0, c[kind] + (was ? -1 : 1)) }));
    try {
      const r = await api.post(`/posts/${post.post_id}/react`, { type: kind });
      // Snap to server truth in case we drifted.
      setReactionCounts((c) => ({ ...c, [kind]: Number(r?.count || 0) }));
    } catch {
      // Revert.
      setMyReactions((prev) => {
        const rev = new Set(prev);
        if (was) rev.add(kind); else rev.delete(kind);
        return rev;
      });
      setReactionCounts((c) => ({ ...c, [kind]: Math.max(0, c[kind] + (was ? 1 : -1)) }));
    }
  };

  // PRD #7: derive interaction prompt label so every card invites engagement.
  const commentCount = post.comment_count || 0;
  const isFresh = post.created_at && (Date.now() - new Date(post.created_at).getTime()) < 3600_000; // < 1h
  const isPopular = likeCount >= 5 || commentCount >= 3;
  const prompt =
    likeCount === 0 && commentCount === 0
      ? { text: 'Be the first to react', emoji: '✨' }
      : commentCount === 0
        ? { text: 'Start the conversation', emoji: '💬' }
        : null;

  const toggleLike = async () => {
    const next = !liked;
    setLiked(next);
    setLikeCount((c: number) => c + (next ? 1 : -1));
    try {
      if (next) await api.post(`/posts/${post.post_id}/like`, {});
      else await api.delete(`/posts/${post.post_id}/like`);
    } catch {
      setLiked(!next);
      setLikeCount((c: number) => c + (next ? -1 : 1));
    }
  };

  // Pull up to 2 specialties for the author chip row.
  const topSpecs: string[] = (post.author?.specialties || []).slice(0, 2);
  const isBot = !!(post.author?.is_bot || post.author?.is_official || post.author?.avatar_kind === 'scout_ai');

  return (
    <Pressable
      onPress={() => router.push(`/community/post/${post.post_id}` as any)}
      style={({ pressed }) => [styles.card, isBot && styles.cardBot, pressed && { opacity: 0.9 }]}
      testID={`post-${post.post_id}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {isBot ? (
          <View style={styles.avatar}><ScoutAIAvatar size={34} /></View>
        ) : post.author?.avatar_url
          ? <Image source={{ uri: post.author.avatar_url }} style={styles.avatar} />
          : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <Text style={styles.authorName}>{post.author?.name || 'Someone'}</Text>
            {isBot ? (
              <View style={[styles.specChip, { flexDirection: 'row', alignItems: 'center', gap: 2 }]}>
                <Sparkles size={9} color={colors.primary} />
                <Text style={styles.specChipTxt}>OFFICIAL AI</Text>
              </View>
            ) : (
              <VerifiedBadge status={post.author?.verification_status} variant="inline" size={12} />
            )}
            {!isBot ? <UserBadge user={post.author} variant="inline" /> : null}
            {!isBot && topSpecs.map((s) => (
              <View key={s} style={styles.specChip}>
                <Text style={styles.specChipTxt}>{s}</Text>
              </View>
            ))}
          </View>
          {/* PRD #7: context chip row — location, relative time, group, new/popular */}
          <View style={styles.contextRow}>
            {!!post.city && (
              <View style={styles.ctxChip}>
                <MapPin size={10} color={colors.textTertiary} />
                <Text style={styles.ctxTxt}>{post.city}{post.state ? `, ${post.state}` : ''}</Text>
              </View>
            )}
            <View style={styles.ctxChip}>
              <Clock size={10} color={colors.textTertiary} />
              <Text style={styles.ctxTxt}>{timeAgo(post.created_at)}</Text>
            </View>
            {!!post.group?.name && (
              <View style={[styles.ctxChip, { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.1)' }]}>
                <Users size={10} color={colors.primary} />
                <Text style={[styles.ctxTxt, { color: colors.primary }]} numberOfLines={1}>{post.group.name}</Text>
              </View>
            )}
            {isFresh && (
              <View style={[styles.ctxChip, { borderColor: colors.success, backgroundColor: 'rgba(46,204,113,0.12)' }]}>
                <Text style={[styles.ctxTxt, { color: colors.success, fontFamily: font.bodyBold }]}>NEW</Text>
              </View>
            )}
            {isPopular && (
              <View style={[styles.ctxChip, { borderColor: colors.secondary, backgroundColor: 'rgba(231,76,60,0.12)' }]}>
                <Flame size={10} color={colors.secondary} />
                <Text style={[styles.ctxTxt, { color: colors.secondary, fontFamily: font.bodyBold }]}>POPULAR</Text>
              </View>
            )}
          </View>
        </View>
        <View style={[styles.catBadge, { borderColor: color, backgroundColor: color + '22' }]}>
          <Cat size={11} color={color} />
          <Text style={[styles.catTxt, { color }]}>{post.category.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.postTitle}>{post.title}</Text>
      {post.body ? <Text style={styles.postBody} numberOfLines={4}>{post.body}</Text> : null}
      {poll ? (
        <View onStartShouldSetResponder={() => true}>
          <PollCard postId={post.post_id} poll={poll} onChange={setPoll} />
        </View>
      ) : null}
      {post.image_url ? <Image source={{ uri: post.image_url }} style={styles.postImg} /> : null}
      {/* Spot attachment (Commit 8c / 2026-04): when a post references a
          spot, render the cover as an inline attachment so the community
          feed isn't a wall of text. Tap routes to the spot. */}
      {post.spot_ref ? (
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); router.push(`/spot/${post.spot_ref.spot_id}` as any); }}
          style={styles.spotAttach}
          testID={`post-spot-${post.post_id}`}
        >
          {post.spot_ref.cover_image_url ? (
            <Image source={{ uri: post.spot_ref.cover_image_url }} style={styles.spotAttachCover} />
          ) : (
            <View style={[styles.spotAttachCover, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
              <MapPin size={18} color={colors.textTertiary} />
            </View>
          )}
          <View style={styles.spotAttachOverlay}>
            <View style={styles.spotAttachKickerWrap}>
              <MapPin size={10} color={colors.primary} />
              <Text style={styles.spotAttachKicker}>SPOT</Text>
            </View>
            <Text style={styles.spotAttachTitle} numberOfLines={1}>{post.spot_ref.title || 'Untitled spot'}</Text>
            {(post.spot_ref.city || post.spot_ref.state) ? (
              <Text style={styles.spotAttachLoc} numberOfLines={1}>
                {[post.spot_ref.city, post.spot_ref.state].filter(Boolean).join(', ')}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ) : null}
      <View style={styles.actions}>
        <TouchableOpacity onPress={toggleLike} style={styles.action} testID={`post-like-${post.post_id}`}>
          <Heart size={15} color={liked ? colors.secondary : colors.textSecondary} fill={liked ? colors.secondary : 'transparent'} />
          <Text style={[styles.actionTxt, liked && { color: colors.secondary }]}>{likeCount}</Text>
        </TouchableOpacity>
        {/* PRD #10: 🔥 Win reaction */}
        <TouchableOpacity
          onPress={() => toggleReaction('win')}
          style={styles.action}
          testID={`post-react-win-${post.post_id}`}
        >
          <Flame
            size={15}
            color={myReactions.has('win') ? '#F97316' : colors.textSecondary}
            fill={myReactions.has('win') ? '#F97316' : 'transparent'}
          />
          <Text style={[styles.actionTxt, myReactions.has('win') && { color: '#F97316', fontFamily: font.bodyBold }]}>
            {reactionCounts.win}
          </Text>
        </TouchableOpacity>
        {/* PRD #10: 💡 Tip reaction */}
        <TouchableOpacity
          onPress={() => toggleReaction('tip')}
          style={styles.action}
          testID={`post-react-tip-${post.post_id}`}
        >
          <Lightbulb
            size={15}
            color={myReactions.has('tip') ? colors.primary : colors.textSecondary}
            fill={myReactions.has('tip') ? colors.primary : 'transparent'}
          />
          <Text style={[styles.actionTxt, myReactions.has('tip') && { color: colors.primary, fontFamily: font.bodyBold }]}>
            {reactionCounts.tip}
          </Text>
        </TouchableOpacity>
        <View style={styles.action}>
          <MessageCircle size={15} color={colors.textSecondary} />
          <Text style={styles.actionTxt}>{commentCount}</Text>
        </View>
        {prompt && (
          <Text style={styles.promptTxt} numberOfLines={1}>
            {prompt.emoji} {prompt.text}
          </Text>
        )}
        {post.author && meId && post.author.user_id !== meId && (
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation?.(); router.push(`/messages/new?user=${post.author.user_id}` as any); }}
            style={[styles.action, styles.dmBtn]}
          >
            <Briefcase size={13} color={colors.primary} />
            <Text style={[styles.actionTxt, { color: colors.primary, fontFamily: font.bodySemibold }]}>Message</Text>
          </TouchableOpacity>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  kicker: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22, lineHeight: 27, letterSpacing: -0.3 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  composeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: colors.primary },
  tabStripScroll: { flexGrow: 0, flexShrink: 0, height: 44 },
  tabStrip: { paddingHorizontal: space.xl, paddingVertical: 6, gap: 6, alignItems: 'center' },
  tab: { height: 30, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  tabTxtActive: { color: colors.textInverse, fontFamily: font.bodySemibold },
  emptyWrap: { alignItems: 'center', paddingHorizontal: space.xl, gap: 8, marginTop: 40 },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 22 },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.primary, marginTop: 10 },
  emptyBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 13 },
  card: { backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, padding: space.md, borderRadius: radii.lg, gap: 10 },
  cardBot: { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.04)' },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  authorName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  authorMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  catBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radii.pill, borderWidth: 1 },
  catTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  postTitle: { color: colors.text, fontFamily: font.display, fontSize: 18, letterSpacing: -0.3, lineHeight: 22 },
  postBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  postImg: { width: '100%', aspectRatio: 16 / 10, borderRadius: radii.md },
  // Spot attachment card — inline mini-card that renders the referenced
  // spot's cover + title. Tapping routes to the spot detail page.
  // (Commit 8c / 2026-04)
  spotAttach: { position: 'relative', borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  spotAttachCover: { width: '100%', aspectRatio: 16 / 9 },
  spotAttachOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  spotAttachKickerWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  spotAttachKicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  spotAttachTitle: { color: '#fff', fontFamily: font.bodySemibold, fontSize: 13 },
  spotAttachLoc: { color: 'rgba(255,255,255,0.8)', fontFamily: font.body, fontSize: 11, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 18, alignItems: 'center', marginTop: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  dmBtn: { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: 'rgba(245,166,35,0.10)', borderWidth: 1, borderColor: colors.primary },

  // PRD #7 — Composer prompt (tap-to-post preview) at top of feed.
  composerPrompt: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.pill, paddingLeft: 6, paddingRight: 6, paddingVertical: 6,
  },
  composerAvatar: { width: 32, height: 32, borderRadius: 16 },
  composerHint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  composerCta: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  composerCtaTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 12, letterSpacing: 0.2 },

  // PRD #7 — Context chip row + author specialty chips + engagement prompt.
  contextRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3 },
  ctxChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    maxWidth: 140,
  },
  ctxTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10, letterSpacing: 0.2 },
  specChip: {
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.10)', borderWidth: 1, borderColor: colors.primary,
  },
  specChipTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase' },
  promptTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, fontStyle: 'italic', flex: 1, marginLeft: 4 },
});
