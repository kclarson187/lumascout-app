import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Plus, MessageCircle, Heart, Users, Sparkles, Coffee, Camera, HandHeart, Wrench, Eye, BookOpen, Briefcase, Star } from 'lucide-react-native';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import VerifiedBadge from '../src/components/VerifiedBadge';

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

export default function Community() {
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
        <TouchableOpacity onPress={() => router.push('/messages')} style={styles.iconBtn} testID="community-messages">
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
  const Cat = CATEGORY_ICONS[post.category] || BookOpen;
  const color = CATEGORY_COLORS[post.category] || colors.primary;

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

  return (
    <Pressable
      onPress={() => router.push(`/community/post/${post.post_id}` as any)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      testID={`post-${post.post_id}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {post.author?.avatar_url
          ? <Image source={{ uri: post.author.avatar_url }} style={styles.avatar} />
          : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.authorName}>{post.author?.name || 'Someone'}</Text>
            <VerifiedBadge status={post.author?.verification_status} variant="inline" size={12} />
          </View>
          <Text style={styles.authorMeta}>
            {post.city ? `${post.city}${post.state ? `, ${post.state}` : ''} · ` : ''}{new Date(post.created_at).toLocaleDateString()}
          </Text>
        </View>
        <View style={[styles.catBadge, { borderColor: color, backgroundColor: color + '22' }]}>
          <Cat size={11} color={color} />
          <Text style={[styles.catTxt, { color }]}>{post.category.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.postTitle}>{post.title}</Text>
      {post.body ? <Text style={styles.postBody} numberOfLines={4}>{post.body}</Text> : null}
      {post.image_url ? <Image source={{ uri: post.image_url }} style={styles.postImg} /> : null}
      <View style={styles.actions}>
        <TouchableOpacity onPress={toggleLike} style={styles.action} testID={`post-like-${post.post_id}`}>
          <Heart size={15} color={liked ? colors.secondary : colors.textSecondary} fill={liked ? colors.secondary : 'transparent'} />
          <Text style={[styles.actionTxt, liked && { color: colors.secondary }]}>{likeCount}</Text>
        </TouchableOpacity>
        <View style={styles.action}>
          <MessageCircle size={15} color={colors.textSecondary} />
          <Text style={styles.actionTxt}>{post.comment_count || 0}</Text>
        </View>
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
  tabStripScroll: { flexGrow: 0, flexShrink: 0, maxHeight: 44 },
  tabStrip: { paddingHorizontal: space.xl, paddingBottom: space.sm, gap: 6, alignItems: 'center' },
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
  avatar: { width: 34, height: 34, borderRadius: 17 },
  authorName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  authorMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  catBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radii.pill, borderWidth: 1 },
  catTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  postTitle: { color: colors.text, fontFamily: font.display, fontSize: 18, letterSpacing: -0.3, lineHeight: 22 },
  postBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  postImg: { width: '100%', aspectRatio: 16 / 10, borderRadius: radii.md },
  actions: { flexDirection: 'row', gap: 18, alignItems: 'center', marginTop: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  dmBtn: { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: 'rgba(245,166,35,0.10)', borderWidth: 1, borderColor: colors.primary },
});
