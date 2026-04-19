import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Eye, Bookmark, Users, Sparkles, TrendingUp } from 'lucide-react-native';
import { api } from '../src/api';
import { colors, font, space, radii } from '../src/theme';
import SpotCard from '../src/components/SpotCard';
import { Button } from '../src/components/Button';

export default function CreatorDashboard() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get('/me/dashboard');
        setData(d);
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!data) return null;

  const tiles = [
    { k: 'total', label: 'Total spots', value: data.total_spots, icon: <Sparkles size={18} color={colors.primary} /> },
    { k: 'public', label: 'Public', value: data.public_spots, icon: <Eye size={18} color={colors.primary} /> },
    { k: 'saves', label: 'Saves received', value: data.saves_received, icon: <Bookmark size={18} color={colors.primary} /> },
    { k: 'followers', label: 'Followers', value: data.followers, icon: <Users size={18} color={colors.primary} /> },
    { k: 'reviews', label: 'Reviews', value: data.reviews_received, icon: <TrendingUp size={18} color={colors.primary} /> },
    { k: 'private', label: 'Private spots', value: data.private_spots, icon: <Sparkles size={18} color={colors.primary} /> },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="creator-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Creator Dashboard</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 100, gap: space.lg }}>
        <View style={styles.grid}>
          {tiles.map((t) => (
            <View key={t.k} style={styles.tile}>
              <View style={styles.tileIcon}>{t.icon}</View>
              <Text style={styles.tileVal}>{t.value}</Text>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.upgradeCard}>
          <Text style={{ color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>Coming Soon</Text>
          <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 22, marginTop: 6 }}>Creator monetization</Text>
          <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 20, marginTop: 6 }}>
            Sell premium spot packs, offer private curated guides, and earn from your best locations.
          </Text>
          <Button title="Upgrade to Creator" onPress={() => router.push('/paywall')} style={{ marginTop: space.md }} testID="dashboard-upgrade" />
        </View>

        {data.top_spots && data.top_spots.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Top performing spots</Text>
            <View style={{ gap: space.md }}>
              {data.top_spots.map((s: any) => (
                <SpotCard key={s.spot_id} spot={s} width={undefined as any} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%', backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    padding: space.lg, borderRadius: radii.lg, gap: 6,
  },
  tileIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  tileVal: { color: colors.text, fontFamily: font.display, fontSize: 34, letterSpacing: -0.5 },
  tileLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
  upgradeCard: {
    backgroundColor: colors.surface1, borderColor: colors.primary, borderWidth: 1,
    padding: space.lg, borderRadius: radii.lg,
  },
  sectionTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, marginTop: space.md },
});
