import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Path, Circle, Line, Text as SvgText } from 'react-native-svg';
import { ChevronLeft, Eye, Bookmark, Users, Sparkles, TrendingUp, Package, Plus } from 'lucide-react-native';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import SpotCard from '../src/components/SpotCard';
import { Button } from '../src/components/Button';

type TrendPoint = { date: string; label: string; spots: number; saves: number };

export default function CreatorDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any | null>(null);
  const [trends, setTrends] = useState<{ series: TrendPoint[]; totals: { spots: number; saves: number } } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, t] = await Promise.all([
          api.get('/me/dashboard'),
          api.get('/me/trends', { days: 7 }).catch(() => null),
        ]);
        setData(d);
        if (t) setTrends(t);
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

  const isElite = user?.plan === 'elite';

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
        {trends && <TrendChart series={trends.series} totals={trends.totals} />}

        <View style={styles.grid}>
          {tiles.map((t) => (
            <View key={t.k} style={styles.tile}>
              <View style={styles.tileIcon}>{t.icon}</View>
              <Text style={styles.tileVal}>{t.value}</Text>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.ctaRow}>
          <TouchableOpacity
            onPress={() => router.push('/creator/packs')}
            style={[styles.ctaCard, { borderColor: isElite ? colors.primary : colors.border }]}
            testID="dashboard-packs"
          >
            <View style={styles.ctaIcon}><Package size={20} color={colors.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.ctaTitle}>{isElite ? 'Manage spot packs' : 'Create spot packs'}</Text>
              <Text style={styles.ctaSub}>{isElite ? 'Bundle your best spots for sale.' : 'Elite plan unlocks pack creation.'}</Text>
            </View>
            <Plus size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {!isElite && (
          <View style={styles.upgradeCard}>
            <Text style={{ color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>Creator monetization</Text>
            <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 22, marginTop: 6 }}>Earn from your best spots</Text>
            <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 20, marginTop: 6 }}>
              Sell premium spot packs, offer private curated guides, and build a following. Stripe checkout launches in the next release.
            </Text>
            <Button title="Upgrade to Elite" onPress={() => router.push('/paywall')} style={{ marginTop: space.md }} testID="dashboard-upgrade" />
          </View>
        )}

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

function TrendChart({ series, totals }: { series: TrendPoint[]; totals: { spots: number; saves: number } }) {
  const screenW = Dimensions.get('window').width;
  const W = Math.min(screenW - 48, 420);
  const H = 140;
  const padX = 12;
  const padY = 20;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const max = Math.max(1, ...series.map((d) => d.saves), ...series.map((d) => d.spots));
  const n = series.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;

  const xFor = (i: number) => padX + i * stepX;
  const yFor = (v: number) => padY + innerH - (v / max) * innerH;

  const pathFor = (key: 'saves' | 'spots') =>
    series
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d[key]).toFixed(1)}`)
      .join(' ');

  // baseline
  const baseY = padY + innerH;

  return (
    <View style={styles.chartCard}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
        <View>
          <Text style={styles.chartLabel}>Last 7 days</Text>
          <Text style={styles.chartTitle}>{totals.saves} saves · {totals.spots} new spots</Text>
        </View>
        <View style={styles.legend}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <Text style={styles.legendTxt}>Saves</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[styles.dot, { backgroundColor: colors.info }]} />
            <Text style={styles.legendTxt}>Spots</Text>
          </View>
        </View>
      </View>
      <Svg width={W} height={H}>
        <Line x1={padX} y1={baseY} x2={W - padX} y2={baseY} stroke={colors.borderSubtle} strokeWidth={1} />
        <Path d={pathFor('saves')} stroke={colors.primary} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={pathFor('spots')} stroke={colors.info} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
        {series.map((d, i) => (
          <React.Fragment key={d.date}>
            <Circle cx={xFor(i)} cy={yFor(d.saves)} r={3} fill={colors.primary} />
            <SvgText
              x={xFor(i)}
              y={H - 4}
              fontSize="9"
              fill={colors.textTertiary}
              textAnchor="middle"
              fontFamily={font.bodyMedium}
            >
              {d.label}
            </SvgText>
          </React.Fragment>
        ))}
      </Svg>
    </View>
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
  earningsTile: { borderColor: colors.primary, position: 'relative', overflow: 'hidden' }, // reserved for future
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
  chartCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    padding: space.lg, borderRadius: radii.lg,
  },
  chartLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  chartTitle: { color: colors.text, fontFamily: font.display, fontSize: 20, letterSpacing: -0.3, marginTop: 2 },
  legend: { gap: 4 },
  legendTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ctaRow: { gap: space.md },
  ctaCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: space.lg, borderRadius: radii.lg,
    backgroundColor: colors.surface1, borderWidth: 1,
  },
  ctaIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 },
  ctaSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
});
