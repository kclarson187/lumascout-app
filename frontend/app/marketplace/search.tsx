/**
 * Pack Marketplace — Search / Filter Results.
 * Path: /marketplace/search?q=&type=&sort=
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Search, ChevronDown, Package } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import ProductCard, { Product } from '../../src/components/ProductCard';

const TYPES: { key: string; label: string }[] = [
  { key: '',            label: 'All' },
  { key: 'preset',      label: 'Presets' },
  { key: 'spot_pack',   label: 'Spot packs' },
  { key: 'city_guide',  label: 'Guides' },
  { key: 'route_pack',  label: 'Routes' },
  { key: 'lut',         label: 'LUTs' },
  { key: 'template',    label: 'Templates' },
  { key: 'mentorship',  label: 'Mentorship' },
];

const SORTS: { key: string; label: string }[] = [
  { key: 'trending',  label: 'Trending' },
  { key: 'newest',    label: 'Newest' },
  { key: 'top_rated', label: 'Top rated' },
  { key: 'price_low', label: 'Price: low to high' },
  { key: 'price_high', label: 'Price: high to low' },
];

export default function MarketplaceSearch() {
  const params = useLocalSearchParams<{ q?: string; type?: string; sort?: string }>();
  const [query, setQuery] = useState((params.q as string) || '');
  const [type, setType] = useState((params.type as string) || '');
  const [sort, setSort] = useState((params.sort as string) || 'trending');
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/marketplace/products', {
        q: query || undefined,
        type: type || undefined,
        sort,
        limit: 30,
      });
      setItems(r.items || []);
      setTotal(r.total || 0);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [query, type, sort]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10} testID="search-back">
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.searchBar}>
          <Search size={16} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={load}
            returnKeyType="search"
            placeholder="Search packs, presets, guides…"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
            autoFocus={!params.q && !params.type}
          />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {TYPES.map((t) => (
          <TouchableOpacity
            key={t.key || 'all'}
            style={[styles.chip, type === t.key && styles.chipActive]}
            onPress={() => setType(t.key)}
          >
            <Text style={[styles.chipTxt, type === t.key && styles.chipTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.sortRow}>
        <Text style={styles.resultsTxt}>{total} {total === 1 ? 'result' : 'results'}</Text>
        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => {
            const i = SORTS.findIndex((s) => s.key === sort);
            setSort(SORTS[(i + 1) % SORTS.length].key);
          }}
        >
          <Text style={styles.sortTxt}>{SORTS.find((s) => s.key === sort)?.label}</Text>
          <ChevronDown size={14} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Package size={32} color={colors.textTertiary} />
          <Text style={styles.emptyHead}>No results yet</Text>
          <Text style={styles.emptySub}>Try a different category or clear your search.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.product_id}
          numColumns={2}
          columnWrapperStyle={{ gap: space.md, paddingHorizontal: space.md }}
          contentContainerStyle={{ paddingBottom: 40, gap: space.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <ProductCard
                product={item}
                onPress={() => router.push(`/marketplace/${item.product_id}` as any)}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.md, paddingVertical: 8,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  searchBar: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10,
    backgroundColor: colors.surface1, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13 },

  chipRow: { paddingHorizontal: space.md, gap: 6, paddingBottom: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  chipTxtActive: { color: colors.textInverse, fontFamily: font.bodyBold },

  sortRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: 8,
  },
  resultsTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },

  empty: { alignItems: 'center', gap: 10, padding: space.xxl },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
});
