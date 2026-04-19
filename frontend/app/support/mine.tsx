import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, MessageSquare } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { EmptyState } from '../../src/components/ui';

export default function MyTickets() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/me/support/tickets');
      setItems(r?.items || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>My tickets</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : items.length === 0 ? (
          <EmptyState icon={<MessageSquare size={28} color={colors.primary} />} title="No tickets yet" body="When you contact support, conversations will appear here." />
        ) : (
          items.map((t) => (
            <View key={t.ticket_id} style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={styles.subj} numberOfLines={1}>{t.subject}</Text>
                <View style={[styles.status, t.status === 'resolved' && { backgroundColor: colors.success }, t.status === 'pending' && { backgroundColor: colors.primary }]}>
                  <Text style={styles.statusTxt}>{(t.status || 'OPEN').toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.body} numberOfLines={3}>{t.body}</Text>
              <Text style={styles.meta}>{new Date(t.created_at).toLocaleDateString()} · {t.category}{t.replies?.length ? `  ·  ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}` : ''}</Text>
              {!!t.replies?.length && (
                <View style={styles.reply}>
                  <Text style={styles.replyFrom}>Staff reply · {new Date(t.replies[t.replies.length - 1].created_at).toLocaleDateString()}</Text>
                  <Text style={styles.replyBody}>{t.replies[t.replies.length - 1].body}</Text>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24, letterSpacing: -0.3 },
  card: { padding: space.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, gap: 6 },
  subj: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, flex: 1 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  meta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  status: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.surface3 },
  statusTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  reply: { marginTop: 6, padding: 10, borderLeftColor: colors.primary, borderLeftWidth: 2, backgroundColor: colors.surface2, borderRadius: radii.sm, gap: 4 },
  replyFrom: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.3 },
  replyBody: { color: colors.text, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
});
