import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, ScrollView } from 'react-native';
import { Flower, Sunset, Leaf, Snowflake } from 'lucide-react-native';
import { api } from '../api';
import { colors, font, space, radii } from '../theme';

const SEASONS = [
  { key: 'spring', label: 'Spring', Icon: Flower, color: '#ec4899' },
  { key: 'summer', label: 'Summer', Icon: Sunset, color: '#f59e0b' },
  { key: 'fall',   label: 'Fall',   Icon: Leaf,   color: '#d97706' },
  { key: 'winter', label: 'Winter', Icon: Snowflake, color: '#60a5fa' },
];

export default function SeasonalTimelineSection({
  spotId, initial }: { spotId: string; initial?: Record<string, any[]> }) {
  const [timeline, setTimeline] = useState<Record<string, any[]>>(initial || {});
  const [ready, setReady] = useState(!!initial);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/spots/${spotId}`);
        if (alive) setTimeline(r.seasonal_timeline || {});
      } finally { if (alive) setReady(true); }
    })();
    return () => { alive = false; };
  }, [spotId, initial]);

  if (!ready) return null;
  const total = SEASONS.reduce((acc, s) => acc + ((timeline[s.key] || []).length), 0);
  if (total === 0) return null;

  return (
    <View style={{ gap: space.md }}>
      {SEASONS.map((s) => {
        const imgs = timeline[s.key] || [];
        if (imgs.length === 0) return null;
        const Icon = s.Icon;
        return (
          <View key={s.key} style={{ gap: 6 }}>
            <View style={styles.seasonRow}>
              <View style={[styles.seasonBadge, { backgroundColor: s.color + '22', borderColor: s.color + '55' }]}>
                <Icon size={12} color={s.color} />
                <Text style={[styles.seasonLbl, { color: s.color }]}>{s.label}</Text>
              </View>
              <Text style={styles.count}>{imgs.length} photo{imgs.length === 1 ? '' : 's'}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.xl, gap: 6 }}>
              {imgs.map((it: any) => (
                <Image key={it.upload_id} source={{ uri: it.image_url }} style={styles.img} />
              ))}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seasonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl },
  seasonBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, borderWidth: 1 },
  seasonLbl: { fontFamily: font.bodyBold, fontSize: 10 },
  count: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  img: { width: 108, height: 108, borderRadius: radii.md } });
