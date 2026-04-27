import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions, RefreshControl } from 'react-native';
import Svg, { Path, Circle, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import UserBadge from '../../src/components/UserBadge';

type Point = { date: string; label: string; signups: number; spots: number; approvals: number; rejections: number };

export default function AdminAnalytics() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get('/admin/analytics', { days: 30 })); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  if (!data) return null;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      <View style={styles.totals}>
        <Total label="Signups"    value={data.totals.signups}    color={colors.success} />
        <Total label="Spots"      value={data.totals.spots}      color={colors.info} />
        <Total label="Approvals"  value={data.totals.approvals}  color={colors.primary} />
        <Total label="Rejections" value={data.totals.rejections} color={colors.secondary} />
      </View>

      <Chart title={`Signups · last ${data.days} days`} series={data.series} keyName="signups"   color={colors.success} />
      <Chart title="Spots created"           series={data.series} keyName="spots"       color={colors.info} />
      <Chart title="Approvals vs Rejections" series={data.series} keyName="approvals"   color={colors.primary} secondary={{ key: 'rejections', color: colors.secondary }} />

      {data.most_saved?.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Most saved spots (all time)</Text>
          <View style={{ gap: 8, marginTop: 6 }}>
            {data.most_saved.map((s: any, i: number) => (
              <View key={s.spot_id} style={styles.savedRow}>
                <Text style={styles.rank}>#{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.savedName} numberOfLines={1}>{s.title}</Text>
                  <Text style={styles.savedMeta}>{s.city}, {s.state}</Text>
                </View>
                <Text style={styles.savedCount}>{s.save_count}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {data.top_cities?.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Top cities (approved spots)</Text>
          <View style={{ gap: 8, marginTop: 6 }}>
            {data.top_cities.map((c: any, i: number) => (
              <View key={`${c.city}-${i}`} style={styles.savedRow}>
                <Text style={styles.rank}>#{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.savedName} numberOfLines={1}>{c.city}</Text>
                  <Text style={styles.savedMeta}>{c.state || '—'}{c.country_code && c.country_code !== 'US' ? ` · ${c.country_code}` : ''}</Text>
                </View>
                <Text style={styles.savedCount}>{c.count}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {data.top_contributors?.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Top contributors</Text>
          <View style={{ gap: 8, marginTop: 6 }}>
            {data.top_contributors.map((u: any, i: number) => (
              <View key={u.user_id} style={styles.savedRow}>
                <Text style={styles.rank}>#{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.savedName} numberOfLines={1}>{u.name || u.username}</Text>
                    <UserBadge user={u} variant="inline" />
                  </View>
                  <Text style={styles.savedMeta}>
                    @{u.username || '—'}{u.city ? ` · ${u.city}${u.state ? ', ' + u.state : ''}` : ''}{u.plan && u.plan !== 'free' ? ` · ${u.plan.toUpperCase()}` : ''}
                  </Text>
                </View>
                <Text style={styles.savedCount}>{u.spot_count}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function Total({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.totalCard, { borderColor: color }]}>
      <Text style={styles.totalVal}>{value.toLocaleString()}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

function Chart({ title, series, keyName, color, secondary }: {
  title: string; series: Point[]; keyName: keyof Point; color: string;
  secondary?: { key: keyof Point; color: string };
}) {
  const screenW = Dimensions.get('window').width;
  const W = Math.min(screenW - 64, 460);
  const H = 150;
  const padX = 12;
  const padY = 18;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const vals = series.map((d) => Number(d[keyName] || 0));
  const sec = secondary ? series.map((d) => Number(d[secondary.key] || 0)) : [];
  const max = Math.max(1, ...vals, ...sec);
  const n = series.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const xFor = (i: number) => padX + i * stepX;
  const yFor = (v: number) => padY + innerH - (v / max) * innerH;

  const pathFor = (key: keyof Point) =>
    series.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(Number(d[key] || 0)).toFixed(1)}`).join(' ');

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Svg width={W} height={H}>
        <SvgLine x1={padX} y1={padY + innerH} x2={W - padX} y2={padY + innerH} stroke={colors.borderSubtle} strokeWidth={1} />
        <Path d={pathFor(keyName)} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {secondary && (
          <Path d={pathFor(secondary.key)} stroke={secondary.color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
        )}
        {series.map((d, i) => (
          i % Math.max(1, Math.round(n / 7)) === 0 ? (
            <SvgText
              key={d.date}
              x={xFor(i)} y={H - 4}
              fontSize="9" fill={colors.textTertiary}
              textAnchor="middle" fontFamily={font.bodyMedium}
            >
              {d.label}
            </SvgText>
          ) : null
        ))}
        {series.map((d, i) => (
          <Circle key={`c-${d.date}`} cx={xFor(i)} cy={yFor(Number(d[keyName] || 0))} r={2.5} fill={color} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  totalCard: { flexBasis: '47%', flexGrow: 1, padding: space.md, backgroundColor: colors.surface1, borderWidth: 1, borderRadius: radii.md, gap: 2 },
  totalVal: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.3 },
  totalLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, padding: space.md, borderRadius: radii.lg, gap: 6 },
  cardTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12, width: 28 },
  savedName: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  savedMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  savedCount: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 14 },
});
