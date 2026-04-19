import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Users, MapPin, Plus, Crown, LogOut } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/ui';
import VerifiedBadge from '../../src/components/VerifiedBadge';

export default function GroupDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = String(params.id || '');
  const { user } = useAuth();
  const [tab, setTab] = useState<'feed' | 'members'>('feed');
  const [group, setGroup] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, p, m] = await Promise.all([
        api.get(`/groups/${id}`).catch(() => null),
        api.get(`/groups/${id}/posts`).catch(() => ({ items: [] })),
        api.get(`/groups/${id}/members`).catch(() => ({ items: [] })),
      ]);
      setGroup(g); setPosts(p?.items || []); setMembers(m?.items || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const join = async () => {
    setJoinBusy(true);
    try { const g = await api.post(`/groups/${id}/join`, {}); setGroup(g); await load(); }
    catch (e) { Alert.alert('Could not join', formatApiError(e)); }
    finally { setJoinBusy(false); }
  };

  const leave = async () => {
    setJoinBusy(true);
    try { const g = await api.delete(`/groups/${id}/join`); setGroup(g); await load(); }
    catch (e) { Alert.alert('Could not leave', formatApiError(e)); }
    finally { setJoinBusy(false); }
  };

  if (loading || !group) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  }

  const isOwner = group.owner_user_id === user?.user_id;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        <View style={styles.headRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
        </View>
        {group.cover_image_url
          ? <Image source={{ uri: group.cover_image_url }} style={styles.cover} />
          : <View style={[styles.cover, { backgroundColor: colors.surface2 }]} />}

        <View style={{ padding: space.xl, gap: space.sm }}>
          <Text style={styles.name}>{group.name}</Text>
          {!!group.tagline && <Text style={styles.tagline}>{group.tagline}</Text>}
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            {!!group.city && <View style={styles.metaPill}><MapPin size={11} color={colors.textSecondary} /><Text style={styles.metaTxt}>{group.city}{group.state ? `, ${group.state}` : ''}</Text></View>}
            <View style={styles.metaPill}><Users size={11} color={colors.textSecondary} /><Text style={styles.metaTxt}>{group.member_count} member{group.member_count === 1 ? '' : 's'}</Text></View>
            {isOwner && <View style={[styles.metaPill, { backgroundColor: 'rgba(245,166,35,0.15)' }]}><Crown size={11} color={colors.primary} /><Text style={[styles.metaTxt, { color: colors.primary }]}>OWNER</Text></View>}
          </View>
          {!!group.description && <Text style={styles.desc}>{group.description}</Text>}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: space.sm }}>
            {group.is_member ? (
              <>
                {!isOwner && <Button title="Leave" variant="secondary" onPress={leave} loading={joinBusy} testID="group-leave" />}
                <Button title="+ New post" onPress={() => router.push({ pathname: '/community/compose', params: { group_id: id } } as any)} style={{ flex: 1 }} testID="group-compose" />
              </>
            ) : (
              <Button title="Join group" onPress={join} loading={joinBusy} style={{ flex: 1 }} testID="group-join" />
            )}
          </View>
        </View>

        <View style={styles.tabs}>
          {(['feed', 'members'] as const).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tabBtn, tab === t && styles.tabBtnActive]}>
              <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>{t === 'feed' ? `Feed (${group.post_count || posts.length})` : `Members (${group.member_count || members.length})`}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ paddingHorizontal: space.xl, gap: space.md }}>
          {tab === 'feed' && (
            posts.length === 0
              ? <EmptyState icon={<Plus size={26} color={colors.primary} />} title="No posts yet" body={group.is_member ? 'Be the first to share something with the group.' : 'Join to share and see new posts.'} />
              : posts.map((p) => (
                  <TouchableOpacity key={p.post_id} style={styles.postCard} onPress={() => router.push(`/community/post/${p.post_id}`)}>
                    <Text style={styles.postTitle}>{p.title}</Text>
                    {!!p.body && <Text style={styles.postBody} numberOfLines={3}>{p.body}</Text>}
                    <Text style={styles.postMeta}>{p.author?.name || 'Someone'} · {new Date(p.created_at).toLocaleDateString()} · {p.like_count || 0} likes · {p.comment_count || 0} replies</Text>
                  </TouchableOpacity>
                ))
          )}

          {tab === 'members' && members.map((m) => (
            <TouchableOpacity key={m.user_id} style={styles.memberRow} onPress={() => router.push(`/user/${m.user_id}`)}>
              {m.profile?.avatar_url
                ? <Image source={{ uri: m.profile.avatar_url }} style={styles.avatar} />
                : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.memberName}>{m.profile?.name || 'Photographer'}</Text>
                  <VerifiedBadge status={m.profile?.verification_status} variant="inline" size={12} />
                </View>
                <Text style={styles.memberMeta}>{m.role === 'owner' ? 'Owner' : 'Member'}{m.profile?.city ? `  ·  ${m.profile.city}` : ''}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', paddingHorizontal: space.xl, paddingTop: space.sm, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  cover: { width: '100%', aspectRatio: 16 / 7 },
  name: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.3 },
  tagline: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 21 },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.surface2, borderRadius: radii.pill },
  metaTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  desc: { color: colors.text, fontFamily: font.body, fontSize: 14, lineHeight: 22, marginTop: space.sm },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: space.xl, marginBottom: space.md, marginTop: space.sm },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12 },
  tabTxtActive: { color: colors.textInverse },
  postCard: { padding: space.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, gap: 4 },
  postTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  postBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  postMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 4 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  memberName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  memberMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
});
