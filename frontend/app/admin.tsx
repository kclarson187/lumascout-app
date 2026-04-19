import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Check, X } from 'lucide-react-native';
import { api, formatApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import SpotCard from '../src/components/SpotCard';
import { EmptyState } from '../src/components/ui';

export default function Admin() {
  const { user } = useAuth();
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/admin/pending');
      setPending(r);
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!user || user.role !== 'admin') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 24 }}>Admin only</Text>
      </SafeAreaView>
    );
  }

  const decide = async (id: string, approve: boolean) => {
    await api.post(`/admin/spots/${id}/${approve ? 'approve' : 'reject'}`);
    load();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Moderation</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : pending.length === 0 ? (
        <EmptyState title="Nothing pending" subtitle="All public submissions have been reviewed." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}>
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
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  card: { gap: space.md },
  actBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: radii.md,
  },
  actTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
});
