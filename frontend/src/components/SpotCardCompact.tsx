import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import SafeImage from './SafeImage';
import { router } from 'expo-router';
import { Star, Sun, Clock, MapPin } from 'lucide-react-native';
import { colors, radii, space, font } from '../theme';
import { formatDistance } from '../utils/distance';
import VerifiedBadge from './VerifiedBadge';
import SpotImageFallback from './SpotImageFallback';
import { resolveSpotCoverForMapThumb } from '../utils/spot-cover';
import { goldenHourLabel } from '../utils/sun';

/**
 * Compact list-style card for the home feed. Used in sections where a
 * full image-first card would be too visually heavy (e.g. "Recently added",
 * "Seasonal highlights"). Keeps the premium dark aesthetic but trades image
 * scale for density so more spots are visible per screen.
 */
export default function SpotCardCompact({
  spot,
  testID,
  emphasis = 'fresh',
}: {
  spot: any;
  testID?: string;
  emphasis?: 'fresh' | 'distance' | 'golden' | 'score' | 'seasonal';
}) {
  // v2.1.0 (May 2026) — single source of truth for cover resolution.
  // SpotCardCompact is a tiny row (thumb ≈ 56×56pt), so MAP_THUMB=280
  // is the right preset — /api/img proxy will 280-wide-thumb it and
  // cache. The shared helper already handles absolutization + resize.
  const cover = resolveSpotCoverForMapThumb(spot);
  const [imgError, setImgError] = useState(false);
  const go = () => router.push(`/spot/${spot.spot_id}`);
  const gLabel = goldenHourLabel(spot.latitude, spot.longitude);

  const distLabel = formatDistance(spot);
  const primary =
    emphasis === 'distance' && distLabel ? { icon: <MapPin size={11} color={colors.primary} />, text: `${distLabel} away` } :
    emphasis === 'golden' && gLabel ? { icon: <Sun size={11} color={colors.primary} />, text: gLabel } :
    emphasis === 'score' ? { icon: <Star size={11} color={colors.primary} fill={colors.primary} />, text: `Score ${spot.shoot_score || 0}` } :
    emphasis === 'seasonal' && spot.best_months?.length ? { icon: <Clock size={11} color={colors.primary} />, text: `Best in ${spot.best_months[0]}` } :
    spot.created_at ? { icon: <Clock size={11} color={colors.primary} />, text: relative(spot.created_at) } :
    null;

  return (
    <Pressable onPress={go} style={styles.row} testID={testID}>
      {cover && !imgError ? (
        <SafeImage
          source={{ uri: cover }}
          style={styles.thumb}
          onError={() => setImgError(true)}
        />
      ) : (
        <View style={styles.thumb}>
          <SpotImageFallback
            title={spot.title}
            shootType={spot.shoot_types?.[0]}
            seed={spot.spot_id || spot.title}
            compact
          />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.title} numberOfLines={1}>{spot.title}</Text>
          <VerifiedBadge status={spot.owner?.verification_status} variant="inline" size={12} />
        </View>
        <Text style={styles.city} numberOfLines={1}>
          {spot.city || '—'}{spot.state ? `, ${spot.state}` : ''}
          {(() => { const d = formatDistance(spot); return d && emphasis !== 'distance' ? `  ·  ${d}` : ''; })()}
        </Text>
        {primary && (
          <View style={styles.primaryRow}>
            {primary.icon}
            <Text style={styles.primaryTxt} numberOfLines={1}>{primary.text}</Text>
          </View>
        )}
      </View>
      <View style={styles.rightCol}>
        <View style={[styles.scoreBadge, { borderColor: (spot.shoot_score || 0) >= 80 ? colors.success : (spot.shoot_score || 0) >= 60 ? colors.primary : colors.secondary }]}>
          <Text style={styles.scoreTxt}>{spot.shoot_score || 0}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function relative(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    const diff = Date.now() - d;
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'Added today';
    if (days === 1) return 'Added yesterday';
    if (days < 7) return `Added ${days}d ago`;
    if (days < 30) return `Added ${Math.floor(days / 7)}w ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 10, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.md,
  },
  thumb: {
    width: 64, height: 64, borderRadius: radii.sm, overflow: 'hidden', backgroundColor: colors.surface2,
  },
  title: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, flex: 1 },
  city: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  primaryTxt: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 11 },
  rightCol: { alignItems: 'flex-end', gap: 6 },
  scoreBadge: {
    minWidth: 38, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radii.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 12 },
});
