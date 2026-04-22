import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ShieldCheck, BellOff } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { timeAgo } from '../../src/components/FreshnessBits';

export default function InboxScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'accepted' | 'requests'>((params.tab as any) || 'accepted');
  const [threads, setThreads] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await api.get('/dm/threads', { tab: 'accepted', limit: 50 });
      setThreads(t.items || []);
      const r = await api.get('/dm/threads', { tab: 'requests', limit: 50 });
      setRequests(r.items || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const accept = async (req: any) => {
    await api.post(`/dm/requests/${req.request_id}/accept`, {});
    router.push(`/inbox/${req.thread_id}` as any);
  };
  const ignore = async (req: any) => {
    await api.post(`/dm/requests/${req.request_id}/ignore`, {});
    setRequests((p) => p.filter((x) => x.request_id !== req.request_id));
  };
  const block = async (req: any) => {
    await api.post(`/dm/requests/${req.request_id}/block`, {});
    setRequests((p) => p.filter((x) => x.request_id !== req.request_id));
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} testID="inbox-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>INBOX</Text>
          <Text style={s.title}>Messages</Text>
        </View>
      </View>
      <View style={s.tabs}>
        <Pressable onPress={() => setTab('accepted')} style={[s.tab, tab === 'accepted' && s.tabActive]} testID="inbox-tab-accepted">
          <Text style={[s.tabTxt, tab === 'accepted' && s.tabTxtActive]}>All</Text>
        </Pressable>
        <Pressable onPress={() => setTab('requests')} style={[s.tab, tab === 'requests' && s.tabActive]} testID="inbox-tab-requests">
          <Text style={[s.tabTxt, tab === 'requests' && s.tabTxtActive]}>Requests{requests.length > 0 ? `  ·  ${requests.length}` : ''}</Text>
        </Pressable>
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : tab === 'requests' ? (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.request_id}
          ListEmptyComponent={<Text style={s.empty}>No message requests.</Text>}
          contentContainerStyle={{ padding: space.md }}
          renderItem={({ item }) => {
            const se = item.sender || {};
            return (
              <View style={s.reqCard} testID={`req-${item.request_id}`}>
                <Pressable onPress={() => router.push(`/user/${se.user_id}` as any)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  {se.avatar_url ? <Image source={{ uri: se.avatar_url }} style={s.reqAvatar}/> : <View style={[s.reqAvatar,{backgroundColor:colors.surface2, alignItems:'center', justifyContent:'center'}]}><Text style={{color:colors.textSecondary,fontFamily:font.bodyBold}}>{se.name?.[0]?.toUpperCase() || '?'}</Text></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={s.reqName}>{se.name || '@'+se.username}{se.verification_status === 'verified' ? ' ' : ''}{se.verification_status === 'verified' ? <ShieldCheck size={12} color="#3b82f6"/> : null}</Text>
                    <Text style={s.reqMeta}>{se.city ? `${se.city}${se.state ? `, ${se.state}` : ''}` : 'Photographer'} · {timeAgo(item.created_at)}</Text>
                    {item.kind && item.kind !== 'message' ? <Text style={s.reqKind}>{item.kind === 'refer' ? '💌 Referral request' : item.kind === 'collab' ? '🤝 Collab invite' : ''}</Text> : null}
                  </View>
                </Pressable>
                <View style={s.reqActions}>
                  <Pressable onPress={() => accept(item)} style={[s.reqBtn, s.reqAccept]} testID={`req-accept-${item.request_id}`}>
                    <Text style={s.reqAcceptTxt}>Accept</Text>
                  </Pressable>
                  <Pressable onPress={() => ignore(item)} style={s.reqBtn} testID={`req-ignore-${item.request_id}`}>
                    <Text style={s.reqBtnTxt}>Ignore</Text>
                  </Pressable>
                  <Pressable onPress={() => block(item)} style={s.reqBtn} testID={`req-block-${item.request_id}`}>
                    <Text style={[s.reqBtnTxt,{color:colors.secondary || '#ef4444'}]}>Block</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.thread_id}
          ListEmptyComponent={<Text style={s.empty}>No conversations yet. Find a photographer to message in the Network tab.</Text>}
          renderItem={({ item }) => {
            const o = item.other || {};
            const unread = item.unread_count > 0;
            return (
              <Pressable onPress={() => router.push(`/inbox/${item.thread_id}` as any)} style={s.threadRow} testID={`thread-${item.thread_id}`}>
                {o.avatar_url ? <Image source={{ uri: o.avatar_url }} style={s.tAvatar}/> : <View style={[s.tAvatar,{backgroundColor:colors.surface2,alignItems:'center',justifyContent:'center'}]}><Text style={{color:colors.textSecondary,fontFamily:font.bodyBold}}>{o.name?.[0]?.toUpperCase() || '?'}</Text></View>}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[s.tName, unread && { fontFamily: font.bodyBold }]} numberOfLines={1}>{o.name || '@'+o.username}</Text>
                    {o.verification_status === 'verified' ? <ShieldCheck size={12} color="#3b82f6"/> : null}
                    {item.is_muted ? <BellOff size={11} color={colors.textTertiary}/> : null}
                    <Text style={s.tTime}>{timeAgo(item.last_message_at) || timeAgo(item.created_at)}</Text>
                  </View>
                  <Text style={[s.tPreview, unread && { color: colors.text }]} numberOfLines={1}>{item.last_message_preview || 'Start a conversation…'}</Text>
                </View>
                {unread ? <View style={s.tUnreadDot}><Text style={s.tUnreadTxt}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text></View> : null}
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={s.sep}/>}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22 },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: space.xl, paddingBottom: space.sm },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: 'rgba(245,166,35,0.14)', borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  tabTxtActive: { color: colors.primary, fontFamily: font.bodySemibold },
  empty: { textAlign: 'center', padding: space.xl, color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  threadRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.xl, paddingVertical: 12 },
  tAvatar: { width: 46, height: 46, borderRadius: 23 },
  tName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, flex: 1 },
  tTime: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
  tPreview: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  tUnreadDot: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  tUnreadTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 70 },
  reqCard: { padding: 12, marginBottom: 10, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, gap: 10 },
  reqAvatar: { width: 46, height: 46, borderRadius: 23 },
  reqName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  reqMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  reqKind: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 4 },
  reqActions: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  reqBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  reqAccept: { backgroundColor: colors.primary, borderColor: colors.primary },
  reqBtnTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  reqAcceptTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
});
