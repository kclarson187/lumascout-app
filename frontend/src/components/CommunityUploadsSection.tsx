import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Heart, ThumbsUp, Camera } from 'lucide-react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { colors, font, space, radii } from '../theme';
import { ConditionChip, timeAgo } from './FreshnessBits';

type Upload = {
  upload_id: string;
  image_url: string;
  caption?: string | null;
  condition_tags?: string[];
  like_count?: number;
  helpful_count?: number;
  liked_by_me?: boolean;
  marked_helpful_by_me?: boolean;
  moderation_status?: string;
  created_at: string;
  contributor?: { name?: string; username?: string; avatar_url?: string | null };
};

export default function CommunityUploadsSection({
  spotId, initial, onAny,
}: { spotId: string; initial?: Upload[]; onAny?: () => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Upload[]>(initial || []);
  const [loading, setLoading] = useState(!initial);
  const [reactingId, setReactingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/spots/${spotId}/uploads`, { limit: 18 });
      setItems(r.items || []);
    } finally { setLoading(false); }
  }, [spotId]);

  useEffect(() => { if (!initial) load(); }, [load, initial]);

  const toggleLike = async (u: Upload) => {
    if (!user || reactingId) return;
    setReactingId(u.upload_id);
    // Optimistic
    setItems((prev) => prev.map((x) => x.upload_id === u.upload_id ? {
      ...x,
      liked_by_me: !x.liked_by_me,
      like_count: (x.like_count || 0) + (x.liked_by_me ? -1 : 1),
    } : x));
    try {
      await api.post(`/spot-uploads/${u.upload_id}/react?kind=like`, {});
      onAny?.();
    } catch {
      // Rollback on error
      setItems((prev) => prev.map((x) => x.upload_id === u.upload_id ? {
        ...x,
        liked_by_me: !x.liked_by_me,
        like_count: (x.like_count || 0) + (x.liked_by_me ? -1 : 1),
      } : x));
    } finally {
      setReactingId(null);
    }
  };

  if (loading) return (
    <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
  );

  if (items.length === 0) return (
    <View style={styles.empty} testID="uploads-empty">
      <View style={styles.emptyIconWrap}><Camera size={22} color={colors.primary} /></View>
      <Text style={styles.emptyTitle}>No recent uploads yet</Text>
      <Text style={styles.emptySubtitle}>Be the first to share a fresh photo of this spot.</Text>
    </View>
  );

  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={items}
      keyExtractor={(it) => it.upload_id}
      contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.sm }}
      renderItem={({ item }) => {
        const pending = item.moderation_status === 'pending';
        return (
          <View style={[styles.card, pending && { opacity: 0.7 }]} testID={`upload-${item.upload_id}`}>
            <Image source={{ uri: item.image_url }} style={styles.cover} />
            {pending ? (
              <View style={styles.pendingBadge}><Text style={styles.pendingBadgeTxt}>Pending review</Text></View>
            ) : null}
            <View style={styles.meta}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {item.contributor?.avatar_url ? (
                  <Image source={{ uri: item.contributor.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: colors.textSecondary, fontSize: 10, fontFamily: font.bodyBold }}>
                      {item.contributor?.name?.[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.author} numberOfLines={1}>{item.contributor?.name || 'Photographer'}</Text>
                  <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
                </View>
              </View>
              {item.caption ? <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text> : null}
              {item.condition_tags && item.condition_tags.length > 0 ? (
                <View style={styles.tags}>
                  {item.condition_tags.slice(0, 3).map((t) => (
                    <ConditionChip key={t} tag={t} selected />
                  ))}
                </View>
              ) : null}
              <View style={styles.actionsRow}>
                <Pressable onPress={() => toggleLike(item)} style={styles.actionBtn} testID={`upload-like-${item.upload_id}`}>
                  <Heart
                    size={14}
                    color={item.liked_by_me ? colors.secondary : colors.textSecondary}
                    fill={item.liked_by_me ? colors.secondary : 'transparent'}
                  />
                  <Text style={[styles.actionTxt, item.liked_by_me && { color: colors.secondary }]}>{item.like_count || 0}</Text>
                </Pressable>
                {typeof item.helpful_count === 'number' && item.helpful_count > 0 ? (
                  <View style={styles.actionBtn}>
                    <ThumbsUp size={14} color={colors.textSecondary} />
                    <Text style={styles.actionTxt}>{item.helpful_count}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  loadingWrap: { paddingVertical: space.lg, alignItems: 'center' },
  empty: { marginHorizontal: space.xl, padding: space.lg, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 6 },
  emptyIconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(245,166,35,0.14)', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  emptySubtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, textAlign: 'center' },
  card: { width: 260, backgroundColor: colors.surface1, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cover: { width: '100%', aspectRatio: 16 / 10 },
  pendingBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(245,166,35,0.9)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill },
  pendingBadgeTxt: { color: '#000', fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  meta: { padding: 10, gap: 6 },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  author: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
  time: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
  caption: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 2 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
});
