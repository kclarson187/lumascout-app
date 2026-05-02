import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator } from 'react-native';
import SafeImage from '../src/components/SafeImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Heart, Camera, CheckCircle, Flower, Sparkles, Image as ImgIcon } from 'lucide-react-native';
import { api } from '../src/api';
import { colors, font, space, radii } from '../src/theme';
import { timeAgo } from '../src/components/FreshnessBits';
import { BrandedRefreshControl, useBrandedRefresh } from '../src/theme/refresh';

/**
 * Notifications inbox — single place to see fresh-photo alerts on saved
 * spots, reactions to your uploads, verified/blooming alerts, and
 * moderator approvals. (Feature 9 Phase 2)
 */

const KIND_ICON: Record<string, any> = {
  saved_spot_fresh_photo: Camera,
  saved_spot_verified: CheckCircle,
  saved_spot_blooming: Flower,
  upload_reaction: Heart,
  upload_approve: CheckCircle,
  upload_feature: Sparkles,
  upload_set_as_cover: ImgIcon,
};

function NotifRow({ n, onTap }: { n: any; onTap: (n: any) => void }) {
  const Icon = KIND_ICON[n.kind] || Sparkles;
  const unread = !n.read_at;
  return (
    <Pressable
      onPress={() => onTap(n)}
      style={[styles.row, unread && styles.rowUnread]}
      testID={`notif-${n.notification_id}`}
    >
      {n.image_url ? (
        <SafeImage source={{ uri: n.image_url }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Icon size={20} color={colors.primary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{n.title}</Text>
        {n.body ? <Text style={styles.body} numberOfLines={2}>{n.body}</Text> : null}
        <Text style={styles.ts}>{timeAgo(n.created_at)}</Text>
      </View>
      {unread ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/notifications', { limit: 60 });
      setItems(r.items || []);
      setUnread(r.unread_count || 0);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // CR Item 11 (May 2026) — branded pull-to-refresh.
  const pullRefresh = useBrandedRefresh<number>({
    load: async () => {
      await load();
      return items.length;
    },
    isChanged: (prev, next) => prev !== null && prev !== next,
  });

  const markAllRead = async () => {
    try {
      await api.post('/notifications/mark-read', {});
      setItems((p) => p.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
      setUnread(0);
    } catch {}
  };

  const onTap = async (n: any) => {
    try { await api.post('/notifications/mark-read', {}, { notification_id: n.notification_id } as any); } catch {}
    if (n.deep_link) router.push(n.deep_link as any);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="notif-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Notifications</Text>
          <Text style={styles.pageTitle}>Inbox{unread > 0 ? `  ·  ${unread} unread` : ''}</Text>
        </View>
        {unread > 0 ? (
          <Pressable onPress={markAllRead} style={styles.markBtn} testID="notif-mark-all">
            <Text style={styles.markBtnTxt}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Sparkles size={28} color={colors.primary} />
          <Text style={styles.emptyTitle}>You're all caught up</Text>
          <Text style={styles.emptySub}>Save some spots and contribute — we'll ping you when your photos get love or when saved spots are verified fresh.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.notification_id}
          renderItem={({ item }) => <NotifRow n={item} onTap={onTap} />}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          contentContainerStyle={{ paddingBottom: 60 }}
          refreshControl={
            <BrandedRefreshControl
              refreshing={pullRefresh.refreshing}
              onRefresh={pullRefresh.onRefresh}
            />
          }
        />
      )}
      <pullRefresh.Toast />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' },
  pageTitle: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  markBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  markBtnTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: 8 },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', maxWidth: 300 },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: space.xl, paddingVertical: 12 },
  rowUnread: { backgroundColor: 'rgba(245,166,35,0.04)' },
  thumb: { width: 46, height: 46, borderRadius: radii.md },
  thumbFallback: { backgroundColor: 'rgba(245,166,35,0.12)', alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  ts: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, marginTop: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 70 },
});
