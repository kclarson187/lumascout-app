import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, MessageCircle, Users } from 'lucide-react-native';
import { api } from '../src/api';
import { colors, font, space, radii } from '../src/theme';
import VerifiedBadge from '../src/components/VerifiedBadge';

export default function Inbox() {
  const [convos, setConvos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setConvos(await api.get('/me/conversations')); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>Messages</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : convos.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MessageCircle size={28} color={colors.primary} />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyBody}>Tap a photographer's profile or post and hit Message to start a chat.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/community')}>
            <Users size={14} color={colors.textInverse} />
            <Text style={styles.emptyBtnTxt}>Browse community</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.xl, gap: 6 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {convos.map((c) => (
            <TouchableOpacity
              key={c.conversation_id}
              style={styles.row}
              onPress={() => router.push(`/messages/${c.conversation_id}` as any)}
              testID={`convo-${c.conversation_id}`}
            >
              {c.other?.avatar_url
                ? <Image source={{ uri: c.other.avatar_url }} style={styles.avatar} />
                : <View style={[styles.avatar, { backgroundColor: colors.surface2 }]} />}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.name} numberOfLines={1}>{c.other?.name || '—'}</Text>
                  <VerifiedBadge status={c.other?.verification_status} variant="inline" size={12} />
                </View>
                <Text style={styles.preview} numberOfLines={1}>{c.last_message || 'No messages yet'}</Text>
              </View>
              {c.unread > 0 && <View style={styles.unread}><Text style={styles.unreadTxt}>{c.unread}</Text></View>}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: space.xl },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 22 },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.primary, marginTop: 10 },
  emptyBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  name: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  preview: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },
});
