/**
 * Pack Marketplace — Storefront
 * Path: /marketplace
 *
 * Premium creator store for photographers. Sells presets, spot packs,
 * city guides, route packs, LUTs, templates, mentorship calls.
 * Platform fee: 15% (configured backend-side).
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  FlatList,
  Image,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, Search, ShoppingBag, Plus, Star, Bookmark, TrendingUp,
  Sparkles, Package, Map as MapIcon, Users, Briefcase, Palette, FileText,
} from 'lucide-react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import ProductCard, { Product } from '../../src/components/ProductCard';

const TYPE_META: Record<string, { label: string; icon: any; emoji: string }> = {
  preset:     { label: 'Presets',      icon: Palette,    emoji: '🎨' },
  spot_pack:  { label: 'Spot Packs',   icon: MapIcon,    emoji: '📍' },
  city_guide: { label: 'Guides',       icon: FileText,   emoji: '🗺️' },
  route_pack: { label: 'Routes',       icon: MapIcon,    emoji: '🛣️' },
  lut:        { label: 'LUTs',         icon: Palette,    emoji: '🎞️' },
  template:   { label: 'Templates',    icon: FileText,   emoji: '📐' },
  mentorship: { label: 'Mentorship',   icon: Users,      emoji: '🎧' },
};

export default function MarketplaceIndex() {
  const { user } = useAuth();
  const [storefront, setStorefront] = useState<{ rails: any; by_type: Record<string, Product[]> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const sf = await api.get('/marketplace/storefront');
      setStorefront(sf);
    } catch (e) { console.warn(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = () => { setRefreshing(true); load(); };

  const onSearch = () => {
    if (query.trim()) router.push(`/marketplace/search?q=${encodeURIComponent(query.trim())}` as any);
  };

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10} testID="mp-back">
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Marketplace</Text>
          <Text style={styles.headerSub}>Presets · Spot packs · Guides</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/me/library' as any)} style={styles.hBtn} hitSlop={10} testID="mp-library">
          <Bookmark size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/me/seller' as any)} style={styles.hBtn} hitSlop={10} testID="mp-seller">
          <Briefcase size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Search size={16} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={onSearch}
          returnKeyType="search"
          placeholder="Search presets, guides, creators…"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          testID="mp-search"
        />
      </View>

      {loading && !storefront ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 130 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {/* Intro banner */}
          <View style={styles.banner}>
            <View style={styles.bannerIconWrap}>
              <ShoppingBag size={18} color={colors.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Creator Marketplace</Text>
              <Text style={styles.bannerSub}>
                Discover curated packs from top photographers. Creators keep {85}% of every sale.
              </Text>
            </View>
          </View>

          {/* Category pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typesRow}>
            {Object.entries(TYPE_META).map(([key, meta]) => (
              <TouchableOpacity
                key={key}
                style={styles.typePill}
                onPress={() => router.push(`/marketplace/search?type=${key}` as any)}
                testID={`mp-type-${key}`}
              >
                <Text style={styles.typePillEmoji}>{meta.emoji}</Text>
                <Text style={styles.typePillTxt}>{meta.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Featured rail */}
          {storefront?.rails.featured?.length > 0 && (
            <Rail
              title="✨ Featured"
              subtitle="Handpicked by our team"
              items={storefront.rails.featured}
            />
          )}

          {/* Trending */}
          {storefront?.rails.trending?.length > 0 && (
            <Rail
              title="🔥 Trending now"
              subtitle="Most-bought this week"
              items={storefront.rails.trending}
            />
          )}

          {/* Newest */}
          {storefront?.rails.newest?.length > 0 && (
            <Rail
              title="🆕 Newest"
              subtitle="Fresh off the press"
              items={storefront.rails.newest}
            />
          )}

          {/* Type-specific rails */}
          {storefront?.by_type &&
            Object.entries(storefront.by_type).map(([type, items]) => (
              <Rail
                key={type}
                title={`${TYPE_META[type]?.emoji}  ${TYPE_META[type]?.label}`}
                subtitle={`${items.length} product${items.length === 1 ? '' : 's'}`}
                items={items}
                onSeeAll={() => router.push(`/marketplace/search?type=${type}` as any)}
              />
            ))}

          {!storefront?.rails.featured?.length &&
           !storefront?.rails.trending?.length &&
           Object.keys(storefront?.by_type || {}).length === 0 ? (
            <View style={styles.emptyCard}>
              <Package size={32} color={colors.textTertiary} />
              <Text style={styles.emptyHead}>Marketplace is just getting started</Text>
              <Text style={styles.emptySub}>
                Be an early creator and list your first pack. Keep 85% of every sale.
              </Text>
              <TouchableOpacity style={styles.emptyCta} onPress={() => router.push('/marketplace/new' as any)}>
                <Text style={styles.emptyCtaTxt}>Start selling</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/marketplace/new' as any)} testID="mp-new">
        <Plus size={20} color={colors.textInverse} />
        <Text style={styles.fabTxt}>List a product</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function Rail({ title, subtitle, items, onSeeAll }: { title: string; subtitle?: string; items: Product[]; onSeeAll?: () => void }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <View style={styles.railHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.railTitle}>{title}</Text>
          {subtitle ? <Text style={styles.railSub}>{subtitle}</Text> : null}
        </View>
        {onSeeAll ? (
          <TouchableOpacity onPress={onSeeAll}>
            <Text style={styles.seeAll}>See all →</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={items}
        keyExtractor={(p) => p.product_id}
        contentContainerStyle={{ paddingHorizontal: space.xl }}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            compact
            onPress={() => router.push(`/marketplace/${item.product_id}` as any)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: space.lg, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  headerSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    margin: space.md, padding: 10,
    backgroundColor: colors.surface1, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: space.md, marginTop: 0,
    padding: 14,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
  },
  bannerIconWrap: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  bannerTitle: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  bannerSub: { color: 'rgba(255,255,255,0.88)', fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },

  typesRow: { paddingHorizontal: space.lg, gap: 8, alignItems: 'center' },
  typePill: {
    height: 40,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 20,
  },
  typePillEmoji: { fontSize: 14, includeFontPadding: false },
  typePillTxt: {
    color: colors.text, fontFamily: font.bodyMedium, fontSize: 13,
    lineHeight: 17, includeFontPadding: false,
  },

  railHead: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: space.xl, marginBottom: space.sm,
  },
  railTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  railSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  seeAll: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },

  emptyCard: {
    alignItems: 'center', padding: space.xxl, gap: 8,
    margin: space.xl,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg,
  },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  emptyCta: { backgroundColor: colors.primary, paddingVertical: 11, paddingHorizontal: 24, borderRadius: radii.md },
  emptyCtaTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },

  fab: {
    position: 'absolute', bottom: 24, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 20,
    backgroundColor: colors.primary, borderRadius: 28,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8,
  },
  fabTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
});
