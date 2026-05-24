/**
 * ParksRail — Phase 3 of the Park-Based Multi-Spot Workflow.
 *
 * Horizontal scrolling rail of parent parks. Surfaces a
 * "Eisenhower Park — 7 photo spots" style card so users can discover
 * grouped destinations from the Explore feed without having to look
 * spot-by-spot.
 *
 * Data source: GET /api/parks/search (no q) — default sort is by
 * `child_spot_count` desc, so the most "valuable" parks bubble up
 * first. When the user has location permission, results are biased
 * toward nearby parks.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Layers, MapPin, ChevronRight } from 'lucide-react-native';
import { api } from '../api';
import { resolveImageUrl } from '../utils/image-url';
import { colors, font, space, radii } from '../theme';

type ParkSummary = {
  park_id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  child_spot_count?: number;
  _distance_km?: number;
  // Optional: a hero image we may pull from /parks/{id} on demand. The
  // search endpoint doesn't include child images today, so the rail
  // shows an icon placeholder unless we extend the API later.
};

type Props = {
  /** If provided, results are biased to be within radius_km of this point. */
  nearLat?: number | null;
  nearLng?: number | null;
};

export default function ParksRail({ nearLat, nearLng }: Props) {
  const [parks, setParks] = useState<ParkSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params: any = { limit: 10 };
        if (typeof nearLat === 'number' && typeof nearLng === 'number') {
          params.near_lat = nearLat;
          params.near_lng = nearLng;
          params.radius_km = 80;
        }
        const r = await api.get('/parks/search', params);
        if (cancelled) return;
        // Filter to parks with at least 2 spots — single-child parks
        // are noise here; the spot card itself is sufficient.
        const filtered = (Array.isArray(r) ? r : []).filter((p: any) => (p.child_spot_count || 0) >= 2);
        setParks(filtered);
      } catch {
        setParks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nearLat, nearLng]);

  if (loading) return null;        // silent until ready
  if (parks.length === 0) return null;  // nothing valuable to show yet

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Layers size={13} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.title}>Photo parks</Text>
            <Text style={styles.sub}>
              Larger areas with multiple shootable spots
            </Text>
          </View>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {parks.map((p) => (
          <TouchableOpacity
            key={p.park_id}
            style={styles.card}
            onPress={() => router.push(`/park/${p.park_id}` as any)}
            activeOpacity={0.85}
            testID={`parks-rail-${p.park_id}`}
          >
            <View style={styles.cardThumb}>
              <Layers size={26} color={colors.primary} />
            </View>
            <View style={{ padding: 10, gap: 4 }}>
              <Text style={styles.cardTitle} numberOfLines={1}>{p.name}</Text>
              <View style={styles.cardCountRow}>
                <Text style={styles.cardCount}>{p.child_spot_count || 0}</Text>
                <Text style={styles.cardCountSub}>
                  photo spot{(p.child_spot_count || 0) === 1 ? '' : 's'}
                </Text>
              </View>
              {(p.city || p.state || typeof p._distance_km === 'number') ? (
                <View style={styles.cardLocRow}>
                  <MapPin size={10} color={colors.textTertiary} />
                  <Text style={styles.cardLoc} numberOfLines={1}>
                    {[p.city, p.state].filter(Boolean).join(', ')}
                    {typeof p._distance_km === 'number'
                      ? `${(p.city || p.state) ? ' · ' : ''}${p._distance_km.toFixed(1)} km`
                      : ''}
                  </Text>
                </View>
              ) : null}
              <View style={styles.openRow}>
                <Text style={styles.openTxt}>Open park</Text>
                <ChevronRight size={11} color={colors.primary} />
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, marginBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 1 },

  scroll: { paddingHorizontal: space.xl, gap: 12 },
  card: {
    width: 200,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    overflow: 'hidden',
  },
  cardThumb: {
    width: '100%', height: 96,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  cardCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  cardCount: { color: colors.primary, fontFamily: font.display, fontSize: 22 },
  cardCountSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  cardLocRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  cardLoc: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, flexShrink: 1 },
  openRow: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4,
  },
  openTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.3 },
});
