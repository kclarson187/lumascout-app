import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, RefreshControl } from 'react-native';
import SafeImage from '../../../src/components/SafeImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Heart, Send, MessageCircle, MapPin } from 'lucide-react-native';
import { api, formatApiError } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { colors, font, space, radii } from '../../../src/theme';
import VerifiedBadge from '../../../src/components/VerifiedBadge';
import UserBadge from '../../../src/components/UserBadge';

import ScreenErrorBoundary from '../../../src/components/ScreenErrorBoundary';

export default function PostDetail() {
  return (
    <ScreenErrorBoundary label="Post">
      <PostDetailImpl />
    </ScreenErrorBoundary>
  );
}

function PostDetailImpl() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [post, setPost] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, c] = await Promise.all([
        api.get(`/posts/${id}`),
        api.get(`/posts/${id}/comments`),
      ]);
      setPost(p); setComments(c || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await api.post(`/posts/${id}/comments`, { body: draft.trim() });
      setDraft('');
      await load();
    } catch (e) { Alert.alert('Could not send', formatApiError(e)); }
    finally { setSending(false); }
  };

  const toggleLike = async () => {
    if (!post) return;
    const next = !post.liked_by_me;
    setPost({ ...post, liked_by_me: next, like_count: (post.like_count || 0) + (next ? 1 : -1) });
    try {
      if (next) await api.post(`/posts/${id}/like`, {});
      else await api.delete(`/posts/${id}/like`);
    } catch {}
  };

  if (loading || !post) return <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
          <Text style={styles.title}>Post</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: space.xl, paddingBottom: 120, gap: space.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          <TouchableOpacity
            style={styles.authorRow}
            onPress={() => post.author?.user_id && router.push(`/user/${post.author.user_id}` as any)}
          >
            {post.author?.avatar_url
              ? <SafeImage source={{ uri: post.author.avatar_url }} style={styles.avatar} />
              : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.author}>{post.author?.name || 'Someone'}</Text>
                <VerifiedBadge status={post.author?.verification_status} variant="inline" size={13} />
                <UserBadge user={post.author} variant="inline" />
              </View>
              <Text style={styles.meta}>{post.city ? `${post.city}, ${post.state} · ` : ''}{new Date(post.created_at).toLocaleString()}</Text>
            </View>
            {post.author?.user_id && user?.user_id !== post.author.user_id && (
              <TouchableOpacity
                style={styles.msgBtn}
                onPress={() => router.push(`/messages/new?user=${post.author.user_id}` as any)}
              >
                <Text style={styles.msgBtnTxt}>Message</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          <View style={styles.catBadgeWrap}><Text style={styles.catBadge}>{post.category.toUpperCase()}</Text></View>
          <Text style={styles.postTitle}>{post.title}</Text>
          {post.body ? <Text style={styles.body}>{post.body}</Text> : null}
          {post.image_url ? <SafeImage source={{ uri: post.image_url }} style={styles.img} /> : null}
          {/* Spot attachment (Commit 8c / 2026-04) */}
          {post.spot_ref ? (
            <TouchableOpacity
              onPress={() => router.push(`/spot/${post.spot_ref.spot_id}` as any)}
              style={styles.spotAttach}
              testID={`post-detail-spot-${post.post_id}`}
            >
              {post.spot_ref.cover_image_url ? (
                <SafeImage source={{ uri: post.spot_ref.cover_image_url }} style={styles.spotAttachCover} />
              ) : (
                <View style={[styles.spotAttachCover, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                  <MapPin size={22} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.spotAttachOverlay}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <MapPin size={11} color={colors.primary} />
                  <Text style={styles.spotAttachKicker}>SPOT</Text>
                </View>
                <Text style={styles.spotAttachTitle} numberOfLines={1}>{post.spot_ref.title || 'Untitled spot'}</Text>
                {(post.spot_ref.city || post.spot_ref.state) ? (
                  <Text style={styles.spotAttachLoc} numberOfLines={1}>
                    {[post.spot_ref.city, post.spot_ref.state].filter(Boolean).join(', ')}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity onPress={toggleLike} style={styles.action}>
              <Heart size={16} color={post.liked_by_me ? colors.secondary : colors.textSecondary} fill={post.liked_by_me ? colors.secondary : 'transparent'} />
              <Text style={[styles.actionTxt, post.liked_by_me && { color: colors.secondary }]}>{post.like_count || 0} likes</Text>
            </TouchableOpacity>
            <View style={styles.action}>
              <MessageCircle size={16} color={colors.textSecondary} />
              <Text style={styles.actionTxt}>{comments.length} comments</Text>
            </View>
          </View>

          <View style={{ gap: 8, marginTop: 6 }}>
            {comments.map((c) => (
              <View key={c.comment_id} style={styles.comment}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {c.author?.avatar_url
                    ? <SafeImage source={{ uri: c.author.avatar_url }} style={styles.avatarSm} />
                    : <View style={[styles.avatarSm, { backgroundColor: colors.surface2 }]} />}
                  <Text style={styles.commentAuthor}>{c.author?.name || '—'}</Text>
                  <VerifiedBadge status={c.author?.verification_status} variant="inline" size={11} />
                  <UserBadge user={c.author} variant="inline" />
                  <Text style={styles.commentTime}>{new Date(c.created_at).toLocaleDateString()}</Text>
                </View>
                <Text style={styles.commentBody}>{c.body}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment…"
            placeholderTextColor={colors.textTertiary}
            style={styles.composerInput}
            multiline
            testID="comment-input"
          />
          <TouchableOpacity
            onPress={submit}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
            testID="comment-send"
          >
            {sending ? <ActivityIndicator size="small" color={colors.textInverse} /> : <Send size={16} color={colors.textInverse} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarSm: { width: 22, height: 22, borderRadius: 11 },
  author: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  msgBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.primary },
  msgBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 12 },
  catBadgeWrap: { alignSelf: 'flex-start' },
  catBadge: { color: colors.primary, backgroundColor: 'rgba(245,166,35,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },
  postTitle: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.5, lineHeight: 32 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 21 },
  img: { width: '100%', aspectRatio: 16 / 10, borderRadius: radii.md },
  // Spot attachment (Commit 8c / 2026-04)
  spotAttach: { position: 'relative', borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, marginTop: 10 },
  spotAttachCover: { width: '100%', aspectRatio: 16 / 9 },
  spotAttachOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  spotAttachKicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6 },
  spotAttachTitle: { color: '#fff', fontFamily: font.bodySemibold, fontSize: 14, marginTop: 2 },
  spotAttachLoc: { color: 'rgba(255,255,255,0.8)', fontFamily: font.body, fontSize: 11, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 20, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
  comment: { padding: space.sm, backgroundColor: colors.surface1, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, gap: 4 },
  commentAuthor: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
  commentTime: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginLeft: 'auto' },
  commentBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18, marginLeft: 28 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: space.md, backgroundColor: colors.surface1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  composerInput: { flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontFamily: font.body, fontSize: 14, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
