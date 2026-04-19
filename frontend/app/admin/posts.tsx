import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Flag, Trash2, RotateCcw, Sparkles, ShieldCheck, AlertCircle } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

type StatusFilter = 'all' | 'active' | 'flagged' | 'removed';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'removed', label: 'Removed' },
];

export default function AdminPosts() {
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 100 };
      if (filter !== 'all') params.status = filter;
      const res = await api.get('/admin/posts', params);
      setPosts(res.items || []);
    } catch (e) {
      Alert.alert('Could not load posts', formatApiError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const remove = (p: any) => {
    Alert.alert(
      'Remove this post?',
      `"${p.title?.slice(0, 60)}${p.title?.length > 60 ? '…' : ''}"\n\nThe author will no longer see it in community feeds.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/admin/posts/${p.post_id}?reason=moderator%20removal`);
              load();
            } catch (e) {
              Alert.alert('Could not remove', formatApiError(e));
            }
          },
        },
      ],
    );
  };

  const restore = (p: any) => {
    Alert.alert('Restore this post?', 'Brings the post back to the public community feed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        onPress: async () => {
          try {
            await api.post(`/admin/posts/${p.post_id}/restore`);
            load();
          } catch (e) {
            Alert.alert('Could not restore', formatApiError(e));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
      >
        {/* Status filter pills */}
        <View style={styles.filterWrap}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <TouchableOpacity
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.filter, active && styles.filterActive]}
                testID={`posts-filter-${f.key}`}
              >
                <Text style={[styles.filterTxt, active && styles.filterTxtActive]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.empty}>
            <Sparkles size={28} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>Nothing to moderate</Text>
            <Text style={styles.emptyBody}>
              {filter === 'flagged'
                ? 'No flagged posts right now. Keep the faith in your community!'
                : 'No posts match this filter.'}
            </Text>
          </View>
        ) : (
          <View style={{ gap: space.md, paddingHorizontal: space.xl }}>
            {posts.map((p) => (
              <View key={p.post_id} style={styles.card} testID={`post-${p.post_id}`}>
                {/* Header */}
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.authorRow}>
                      {p.author?.avatar_url ? (
                        <Image source={{ uri: p.author.avatar_url }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, { alignItems: 'center', justifyContent: 'center' }]}>
                          <Text style={styles.avatarInitial}>{p.author?.name?.[0]?.toUpperCase() || '?'}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={styles.authorName}>{p.author?.name || 'Unknown'}</Text>
                          {p.author?.verification_status === 'verified' && (
                            <ShieldCheck size={12} color={colors.info} />
                          )}
                        </View>
                        <Text style={styles.authorMeta}>
                          @{p.author?.username || '—'} · {new Date(p.created_at).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={[styles.statusChip, statusStyle(p.status)]}>
                    <Text style={[styles.statusChipTxt, statusTxtStyle(p.status)]}>
                      {(p.status || 'active').toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Body */}
                <Text style={styles.category}>{(p.category || 'post').toUpperCase()}</Text>
                <Text style={styles.title}>{p.title}</Text>
                {!!p.body && <Text style={styles.body} numberOfLines={4}>{p.body}</Text>}
                {!!p.image_url && (
                  <Image source={{ uri: p.image_url }} style={styles.postImg} resizeMode="cover" />
                )}

                {/* Meta + actions */}
                <View style={styles.metaRow}>
                  <Text style={styles.metaTxt}>
                    {(p.like_count || 0)} likes · {(p.comment_count || 0)} comments
                  </Text>
                  {p.open_reports > 0 && (
                    <View style={styles.reportBadge}>
                      <Flag size={10} color={colors.textInverse} />
                      <Text style={styles.reportBadgeTxt}>
                        {p.open_reports} open report{p.open_reports === 1 ? '' : 's'}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.actRow}>
                  <TouchableOpacity
                    style={styles.viewBtn}
                    onPress={() => router.push(`/community/post/${p.post_id}`)}
                  >
                    <Text style={styles.viewBtnTxt}>View in feed</Text>
                  </TouchableOpacity>
                  {p.status !== 'removed' ? (
                    <TouchableOpacity
                      style={[styles.actBtn, styles.removeBtn]}
                      onPress={() => remove(p)}
                      testID={`remove-${p.post_id}`}
                    >
                      <Trash2 size={14} color={colors.textInverse} />
                      <Text style={styles.removeBtnTxt}>Remove</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.actBtn, styles.restoreBtn]}
                      onPress={() => restore(p)}
                      testID={`restore-${p.post_id}`}
                    >
                      <RotateCcw size={14} color={colors.text} />
                      <Text style={styles.restoreBtnTxt}>Restore</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function statusStyle(s: string) {
  if (s === 'removed') return { backgroundColor: 'rgba(208,72,72,0.15)', borderColor: colors.secondary };
  if (s === 'flagged') return { backgroundColor: 'rgba(245,166,35,0.18)', borderColor: colors.primary };
  return { backgroundColor: 'rgba(16,185,129,0.15)', borderColor: colors.success };
}
function statusTxtStyle(s: string) {
  if (s === 'removed') return { color: colors.secondary };
  if (s === 'flagged') return { color: colors.primary };
  return { color: colors.success };
}

const styles = StyleSheet.create({
  filterWrap: {
    flexDirection: 'row', gap: 8, paddingHorizontal: space.xl, paddingVertical: space.md,
    alignItems: 'center',
  },
  filter: {
    height: 30, paddingHorizontal: 12, justifyContent: 'center',
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.pill,
  },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12 },
  filterTxtActive: { color: colors.textInverse },

  empty: { padding: 40, alignItems: 'center', gap: 8 },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 20, marginTop: 8 },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', paddingHorizontal: space.xl },

  card: {
    backgroundColor: colors.surface1, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 8,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface2 },
  avatarInitial: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  authorName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  authorMeta: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 2 },

  statusChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, borderWidth: 1,
  },
  statusChipTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.5 },

  category: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8, marginTop: 2 },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  postImg: { width: '100%', height: 160, borderRadius: radii.sm, marginTop: 4, backgroundColor: colors.surface2 },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  metaTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11 },
  reportBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.secondary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.pill,
  },
  reportBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.3 },

  actRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  viewBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, backgroundColor: colors.surface2,
  },
  viewBtnTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12 },
  actBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: radii.md,
  },
  removeBtn: { backgroundColor: colors.secondary },
  removeBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
  restoreBtn: { backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1 },
  restoreBtnTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12 },
});
