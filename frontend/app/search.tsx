import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Search, X } from 'lucide-react-native';
import { api } from '../src/api';
import { colors, font, space, radii, QUICK_FILTERS } from '../src/theme';
import SpotCard from '../src/components/SpotCard';
import { Chip, EmptyState } from '../src/components/ui';

export default function SearchScreen() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q) { setResults(null); return; }
    let canceled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get('/spots', { q, limit: 30 });
        if (!canceled) setResults(r);
      } finally { if (!canceled) setLoading(false); }
    }, 300);
    return () => { canceled = true; clearTimeout(t); };
  }, [q]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="search-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.inputBox}>
          <Search size={18} color={colors.textSecondary} />
          <TextInput
            placeholder="Search cities, spots, golden hour, dog friendly..."
            placeholderTextColor={colors.textTertiary}
            value={q}
            onChangeText={setQ}
            autoFocus
            style={styles.input}
            testID="search-input"
          />
          {q ? (
            <TouchableOpacity onPress={() => setQ('')}>
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {!q && (
        <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
          <View>
            <Text style={styles.suggestHead}>Popular filters</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {QUICK_FILTERS.map((f) => (
                <Chip key={f} label={f} onPress={() => setQ(f)} />
              ))}
            </View>
          </View>
          <View>
            <Text style={styles.suggestHead}>Search by location</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {['Austin', 'San Antonio', 'Dallas', 'Houston', 'Fredericksburg', 'Hill Country'].map((c) => (
                <Chip key={c} label={c} onPress={() => setQ(c)} />
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {q && results && (
        results.length === 0 ? (
          <EmptyState title="No matches" subtitle="Try a different search term." />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(i) => i.spot_id}
            contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}
            renderItem={({ item }) => <SpotCard spot={item} width={undefined as any} />}
          />
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.xl, paddingVertical: space.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inputBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: space.md, borderRadius: radii.md,
  },
  input: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 15, paddingVertical: 12 },
  suggestHead: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginBottom: space.md,
  },
});
