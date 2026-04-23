/**
 * My Purchases (a.k.a. Library) — user's owned marketplace products.
 * Path: /me/library
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
  Image,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { ArrowLeft, Download, Package, ShoppingBag } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

export default function MyLibrary() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/me/marketplace/library');
      setItems(r.items || []);
    } catch {} finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openContents = (url?: string) => {
    if (!url) { Alert.alert('No link', 'The creator hasn\'t uploaded a delivery link yet.'); return; }
    Linking.openURL(url).catch(() => Alert.alert('Could not open link'));
  };

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>My Purchases</Text>
          <Text style={styles.headerSub}>{items.length} item{items.length === 1 ? '' : 's'}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Package size={36} color={colors.textTertiary} />
          <Text style={styles.emptyHead}>Your library is empty</Text>
          <Text style={styles.emptySub}>Start browsing the marketplace for presets and guides.</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.push('/marketplace' as any)}>
            <ShoppingBag size={14} color={colors.textInverse} />
            <Text style={styles.ctaTxt}>Browse marketplace</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {items.map((row) => (
            <View key={row.purchase_id} style={styles.card}>
              <TouchableOpacity onPress={() => router.push(`/marketplace/${row.product.product_id}` as any)} style={{ flexDirection: 'row', gap: 12 }}>
                {row.product.thumbnail_url ? (
                  <Image source={{ uri: row.product.thumbnail_url }} style={styles.thumb} />
                ) : <View style={[styles.thumb, { backgroundColor: colors.surface2 }]} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.pTitle} numberOfLines={2}>{row.product.title}</Text>
                  <Text style={styles.pSeller}>by {row.product.seller?.name || 'Creator'}</Text>
                  <Text style={styles.pDate}>Purchased {row.purchased_at ? new Date(row.purchased_at).toLocaleDateString() : ''}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.downloadBtn} onPress={() => openContents(row.product.contents_url)}>
                <Download size={14} color={colors.textInverse} />
                <Text style={styles.downloadTxt}>Download</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.sm, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  headerSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: 10 },
  emptyHead: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  emptySub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center' },
  cta: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 18, backgroundColor: colors.primary, borderRadius: radii.md },
  ctaTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },

  card: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: 12, gap: 10,
  },
  thumb: { width: 80, height: 80, borderRadius: radii.md },
  pTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  pSeller: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  pDate: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 4 },

  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.primary, borderRadius: radii.md,
  },
  downloadTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
});
