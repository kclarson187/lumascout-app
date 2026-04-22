import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors, font, space, radii } from '../theme';
import { ConditionChip, timeAgo } from './FreshnessBits';
import { PenLine } from 'lucide-react-native';

type Update = {
  update_id: string;
  text: string;
  condition_tags?: string[];
  moderation_status?: string;
  created_at: string;
  contributor?: { name?: string; username?: string; avatar_url?: string | null };
};

export default function LatestConditionsSection({
  spotId, initial,
}: { spotId: string; initial?: Update[] }) {
  const [items, setItems] = useState<Update[]>(initial || []);
  const [loading, setLoading] = useState(!initial);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/spots/${spotId}/updates`, { limit: 8 });
      setItems(r.items || []);
    } finally { setLoading(false); }
  }, [spotId]);

  useEffect(() => { if (!initial) load(); }, [load, initial]);

  if (loading) return (
    <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
  );

  if (items.length === 0) return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}><PenLine size={18} color={colors.primary} /></View>
      <Text style={styles.emptyTitle}>No recent updates yet</Text>
      <Text style={styles.emptySubtitle}>Check-in with conditions to help other photographers plan their shoot.</Text>
    </View>
  );

  return (
    <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>
      {items.map((it) => {
        const pending = it.moderation_status === 'pending';
        return (
          <View key={it.update_id} style={[styles.row, pending && { opacity: 0.7 }]} testID={`update-${it.update_id}`}>
            {it.contributor?.avatar_url ? (
              <Image source={{ uri: it.contributor.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, fontFamily: font.bodyBold }}>
                  {it.contributor?.name?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.author}>{it.contributor?.name || 'Photographer'}</Text>
                <Text style={styles.time}>· {timeAgo(it.created_at)}</Text>
                {pending ? <Text style={styles.pending}>Pending</Text> : null}
              </View>
              <Text style={styles.text}>{it.text}</Text>
              {it.condition_tags && it.condition_tags.length > 0 ? (
                <View style={styles.tags}>
                  {it.condition_tags.map((t) => (
                    <ConditionChip key={t} tag={t} selected />
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { paddingVertical: space.lg, alignItems: 'center' },
  empty: { marginHorizontal: space.xl, padding: space.lg, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 6 },
  emptyIconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(245,166,35,0.14)', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  emptySubtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: colors.surface1, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  author: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  time: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  pending: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: 4 },
  text: { color: colors.text, fontFamily: font.body, fontSize: 13, marginTop: 3 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
});
