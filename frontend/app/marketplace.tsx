import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Package, Lock, DollarSign, Sparkles } from 'lucide-react-native';
import { api, formatApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import { Button } from '../src/components/Button';
import { EmptyState } from '../src/components/ui';

export default function Marketplace() {
  const { user } = useAuth();
  const [packs, setPacks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/packs', { published: true });
        setPacks(r);
      } finally { setLoading(false); }
    })();
  }, []);

  const joinWaitlist = async (packId: string) => {
    try {
      const r = await api.post(`/packs/${packId}/purchase`);
      Alert.alert('On the waitlist', r.message || 'We\'ll notify you the moment checkout opens.');
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="market-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Marketplace</Text>
      </View>

      <View style={styles.banner}>
        <Sparkles size={18} color={colors.primary} />
        <Text style={styles.bannerTxt}>
          Curated spot packs from verified photographers. Checkout opens with Stripe next release — waitlist now.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : packs.length === 0 ? (
        <EmptyState
          title="Marketplace is warming up"
          subtitle="Elite creators are packaging their best locations right now. Check back soon — or become an Elite creator and be the first to publish."
          action={<Button title="Become a creator" onPress={() => router.push('/paywall')} />}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}>
          {packs.map((p) => (
            <View key={p.pack_id} style={styles.packCard}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={styles.packIcon}><Package size={22} color={colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.packName}>{p.name}</Text>
                  <Text style={styles.packMeta}>
                    {(p.spot_ids || []).length} spots · ${(p.price_cents / 100).toFixed(2)}
                  </Text>
                </View>
                <View style={styles.priceTag}>
                  <DollarSign size={12} color={colors.textInverse} />
                  <Text style={styles.priceTxt}>{(p.price_cents / 100).toFixed(0)}</Text>
                </View>
              </View>
              {p.description ? <Text style={styles.packDesc} numberOfLines={3}>{p.description}</Text> : null}
              <View style={styles.lockedRow}>
                <Lock size={12} color={colors.textTertiary} />
                <Text style={styles.lockedTxt}>Full spot list unlocks at purchase</Text>
              </View>
              <Button
                title="Join waitlist"
                variant="secondary"
                onPress={() => joinWaitlist(p.pack_id)}
                testID={`market-waitlist-${p.pack_id}`}
              />
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
  title: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginHorizontal: space.xl, marginBottom: space.md,
    padding: space.md, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.08)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)',
  },
  bannerTxt: { color: colors.text, fontFamily: font.body, fontSize: 12, lineHeight: 18, flex: 1 },
  packCard: {
    padding: space.lg, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, gap: space.md,
  },
  packIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  packName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 16 },
  packMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  packDesc: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  priceTag: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill,
  },
  priceTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 12 },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lockedTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
});
