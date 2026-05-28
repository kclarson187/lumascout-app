/**
 * PortfolioGrid — Profile "Portfolio" tab (Jun 2025).
 *
 * Layout
 *  • Sticky "All / <Category>" filter chips at the top, built
 *    dynamically from the actual photo set (no fake empty categories).
 *  • 2-column hand-rolled masonry. Each photo's aspect ratio drives its
 *    tile height so the grid reads like a curated portfolio, not a
 *    uniform calendar. We split into two columns by total column
 *    height (greedy) so the shorter column always gets the next photo.
 *
 * Performance
 *  • Photos array is provided as a memoized prop (see profile.tsx).
 *  • Cards use `expo-image` with `cachePolicy="memory-disk"` so
 *    scroll-back is free. We deliberately cap to 60 tiles per tab
 *    view to keep memory steady on lower-end Android.
 *  • Per-tile error is silently swallowed and the slot collapses to a
 *    surface tone — a broken URL never breaks the row.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Camera } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, font, space, radii } from '../theme';
import { EmptyState } from './ui';

export interface PortfolioPhoto {
  url: string;            // optimized thumbnail preferred
  spot_id?: string;
  category?: string | null;
  /** Aspect ratio width/height. If absent we render with 1.0 and let
   *  the masonry split engine even the column heights anyway. */
  aspect_ratio?: number;
}

interface Props {
  photos: PortfolioPhoto[];
  /** Optional cap on photos rendered. Defaults to 60 for perf. */
  limit?: number;
}

export default function PortfolioGrid({ photos, limit = 60 }: Props) {
  const [activeCat, setActiveCat] = useState<string | null>(null);

  // Build chips from real data. "All" is always present; per-category
  // chips only appear if there's at least one matching photo (no fake
  // empty categories per Jun 2025 spec).
  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of photos) {
      const c = (p.category || '').trim();
      if (!c) continue;
      counts[c] = (counts[c] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  }, [photos]);

  const filtered = useMemo(() => {
    const base = activeCat
      ? photos.filter((p) => (p.category || '').trim() === activeCat)
      : photos;
    return base.slice(0, limit);
  }, [photos, activeCat, limit]);

  // Two-column masonry — greedy column packing keeps the bottoms even.
  const { colA, colB } = useMemo(() => {
    const a: PortfolioPhoto[] = [];
    const b: PortfolioPhoto[] = [];
    let aH = 0;
    let bH = 0;
    for (const p of filtered) {
      const ratio = p.aspect_ratio && Number.isFinite(p.aspect_ratio) && p.aspect_ratio > 0
        ? p.aspect_ratio
        : 1;
      const tileHeight = 1 / ratio; // unit height (column-width = 1)
      if (aH <= bH) {
        a.push(p);
        aH += tileHeight;
      } else {
        b.push(p);
        bH += tileHeight;
      }
    }
    return { colA: a, colB: b };
  }, [filtered]);

  if (photos.length === 0) {
    return (
      <EmptyState
        title="Upload a spot to start your portfolio"
        subtitle="Photos from your contributed spots and community uploads will appear here in a curated grid."
        icon={<Camera size={28} color={colors.textSecondary} />}
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {/* Filter chips */}
      {categories.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          <Chip label="All" active={activeCat == null} onPress={() => setActiveCat(null)} />
          {categories.map((c) => (
            <Chip key={c} label={c} active={activeCat === c} onPress={() => setActiveCat(c)} />
          ))}
        </ScrollView>
      ) : null}

      {/* Masonry */}
      <View style={styles.masonryRow}>
        <View style={styles.masonryCol}>
          {colA.map((p, i) => (
            <MasonryTile key={`a-${i}-${p.url}`} photo={p} />
          ))}
        </View>
        <View style={styles.masonryCol}>
          {colB.map((p, i) => (
            <MasonryTile key={`b-${i}-${p.url}`} photo={p} />
          ))}
        </View>
      </View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      testID={`portfolio-chip-${label}`}
    >
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function MasonryTile({ photo }: { photo: PortfolioPhoto }) {
  const [err, setErr] = useState(false);
  const ratio = photo.aspect_ratio && Number.isFinite(photo.aspect_ratio) && photo.aspect_ratio > 0
    ? photo.aspect_ratio
    : 1;

  const onPress = () => {
    if (photo.spot_id) {
      router.push(`/spot/${photo.spot_id}` as any);
    }
  };

  if (err) {
    return <View style={[styles.tile, { aspectRatio: ratio, backgroundColor: colors.surface2 }]} />;
  }

  return (
    <Pressable onPress={onPress} style={[styles.tile, { aspectRatio: ratio }]} testID="portfolio-tile">
      <Image
        source={{ uri: photo.url }}
        style={StyleSheet.absoluteFillObject}
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={150}
        onError={() => setErr(true)}
        recyclingKey={photo.url}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipsRow: { gap: 8, paddingHorizontal: 2, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: {
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderColor: 'rgba(245,166,35,0.45)',
  },
  chipTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodySemibold,
    fontSize: 11.5,
    letterSpacing: 0.1,
  },
  chipTxtActive: { color: colors.primary },
  masonryRow: { flexDirection: 'row', gap: 6 },
  masonryCol: { flex: 1, gap: 6 },
  tile: {
    width: '100%',
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
});
