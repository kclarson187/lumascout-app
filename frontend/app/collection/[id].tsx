import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { EmptyState } from '../../src/components/ui';

export default function Collection() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [col, setCol] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/collections/${id}`);
      setCol(d);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{col?.name || 'Collection'}</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : !col || !col.spots?.length ? (
        <EmptyState title="Empty collection" subtitle="Add spots to this collection from any spot detail." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}>
          {col.spots.map((s: any) => <SpotCard key={s.spot_id} spot={s} width={undefined as any} />)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
});
