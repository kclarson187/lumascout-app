import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { EmptyState } from '../../src/components/ui';

export default function AdminSpots() {
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setPending(await api.get('/admin/pending')); }
    catch (e) { Alert.alert('Error', formatApiError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    try {
      await api.post(`/admin/spots/${id}/${approve ? 'approve' : 'reject'}`);
      await load();
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
  };

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  }
  if (pending.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
      >
        <EmptyState title="Nothing pending" subtitle="All public submissions have been reviewed." />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      <Text style={styles.totals}>{pending.length} pending submission{pending.length === 1 ? '' : 's'}</Text>
      {pending.map((s) => (
        <View key={s.spot_id} style={styles.card}>
          <SpotCard spot={s} width={undefined as any} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[styles.actBtn, { backgroundColor: colors.success }]} onPress={() => decide(s.spot_id, true)} testID={`admin-approve-${s.spot_id}`}>
              <Check size={16} color={colors.textInverse} />
              <Text style={styles.actTxt}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actBtn, { backgroundColor: colors.secondary }]} onPress={() => decide(s.spot_id, false)} testID={`admin-reject-${s.spot_id}`}>
              <X size={16} color="#fff" />
              <Text style={[styles.actTxt, { color: '#fff' }]}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  totals: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  card: { gap: space.md },
  actBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: radii.md },
  actTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
});
