/**
 * /followers & /following — dedicated user-list screens.
 *
 *   Reuses /api/me/followers and /api/me/following (Apr 2026 backend).
 *   Each row renders avatar + name + city + verified/elite badge with
 *   a tap that deep-links into the existing /user/[id] profile route.
 *
 *   Driven by route segments: /followers and /following both render
 *   this single screen. We keep the file in app/ so expo-router exposes
 *   it as a top-level route.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, Image, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, usePathname } from 'expo-router';
import { ChevronLeft, ShieldCheck, Gem, MapPin } from 'lucide-react-native';
import { api } from '../api';
import { colors, font, space } from '../theme';
import UserBadge from './UserBadge';

type FollowUser = {
  user_id: string;
  name?: string;
  username?: string;
  avatar_url?: string;
  city?: string;
  state?: string;
  verification_status?: string;
  plan?: string;
  followed_at?: string;
};

export default function FollowListScreen() {
  // The same component renders /followers and /following — switch on
  // the current route so we hit the right backend endpoint and label.
  const pathname = usePathname();
  const mode: 'followers' | 'following' =
    pathname?.startsWith('/following') ? 'following' : 'followers';
  const title = mode === 'followers' ? 'Followers' : 'Following';
  const endpoint = mode === 'followers' ? '/me/followers' : '/me/following';

  const [items, setItems] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      try {
        const r = await api.get(endpoint, { limit: 200 });
        setItems(Array.isArray(r) ? r : (r?.items || []));
      } catch {
        setItems([]);
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          style={s.backBtn}
          hitSlop={8}
          testID="follow-back"
        >
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <Text style={s.title}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>
            {mode === 'followers' ? 'No followers yet' : 'You\u2019re not following anyone yet'}
          </Text>
          <Text style={s.emptyBody}>
            {mode === 'followers'
              ? 'Share spots, post photos, and engage with the community to grow your audience.'
              : 'Discover photographers from the Network tab and follow creators you admire.'}
          </Text>
          <Pressable
            onPress={() => router.push('/(tabs)/network' as any)}
            style={s.emptyCta}
            testID="follow-empty-cta"
          >
            <Text style={s.emptyCtaTxt}>
              {mode === 'followers' ? 'Open Network' : 'Discover photographers'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(u) => u.user_id}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 60, gap: 8 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => <UserRow u={item} />}
          ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function UserRow({ u }: { u: FollowUser }) {
  const verified = u.verification_status === 'verified';
  const elite = u.plan === 'elite';
  return (
    <Pressable
      onPress={() => router.push(`/user/${u.user_id}` as any)}
      style={[s.row, elite && s.rowElite]}
      testID={`follow-row-${u.user_id}`}
    >
      <View style={[s.avatarWrap, elite && s.avatarWrapElite]}>
        {u.avatar_url ? (
          <Image source={{ uri: u.avatar_url }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 16 }}>
              {(u.name || u.username || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={s.name} numberOfLines={1}>
            {u.name || `@${u.username || 'user'}`}
          </Text>
          {verified ? (
            <View style={s.verifiedDot}>
              <Text style={s.verifiedDotTxt}>✓</Text>
            </View>
          ) : null}
          <UserBadge user={u} variant="compact" />
        </View>
        {u.username ? (
          <Text style={s.username} numberOfLines={1}>@{u.username}</Text>
        ) : null}
        {u.city ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <MapPin size={10} color={colors.textTertiary} />
            <Text style={s.city} numberOfLines={1}>
              {u.city}{u.state ? `, ${u.state}` : ''}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    gap: 4,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: font.display,
    fontSize: 20,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: 8,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 16,
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
  emptyCta: {
    paddingHorizontal: 18,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  emptyCtaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 13 },
  // Row card
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowElite: { borderColor: 'rgba(245,166,35,0.5)' },
  avatarWrap: {
    width: 50, height: 50, borderRadius: 25,
    padding: 2,
  },
  avatarWrapElite: { backgroundColor: colors.primary },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  name: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 14,
    flexShrink: 1,
  },
  username: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  city: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
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
});
