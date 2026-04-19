import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Bookmark, Star, Shield, Lock, EyeOff, MapPin } from 'lucide-react-native';
import { colors, radii, space, font } from '../theme';
import { api } from '../api';
import FreshnessBadge from './FreshnessBadge';
import VerifiedBadge from './VerifiedBadge';

export type Spot = any;

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? colors.success : score >= 60 ? colors.primary : colors.secondary;
  return (
    <View style={[styles.scoreBadge, { borderColor: color }]}>
      <Text style={[styles.scoreText, { color }]}>{score}</Text>
    </View>
  );
}

export default function SpotCard({
  spot,
  onPress,
  onToggleSave,
  width = 260,
  testID,
}: {
  spot: Spot;
  onPress?: () => void;
  onToggleSave?: () => void;
  width?: number;
  testID?: string;
}) {
  const cover = (spot.images && (spot.images.find((i: any) => i.is_cover) || spot.images[0]))?.image_url;
  const isPremium = spot.privacy_mode === 'premium';

  const handlePress = () => {
    if (onPress) return onPress();
    router.push(`/spot/${spot.spot_id}`);
  };

  const handleSave = async (e: any) => {
    e?.stopPropagation?.();
    try {
      await api.post(`/spots/${spot.spot_id}/save`);
      onToggleSave?.();
    } catch {}
  };

  return (
    <Pressable onPress={handlePress} style={[styles.card, { width }]} testID={testID}>
      <View style={styles.imageWrap}>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.image} />
        ) : (
          <View style={[styles.image, { backgroundColor: colors.surface2 }]} />
        )}
        <View style={styles.overlayTop}>
          {isPremium && (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumText}>PREMIUM</Text>
            </View>
          )}
          {spot.privacy_mode === 'private' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(10,10,10,0.8)', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <Lock size={9} color="#fff" />
              <Text style={[styles.premiumText, { color: '#fff' }]}>PRIVATE</Text>
            </View>
          )}
          {spot.privacy_mode === 'followers' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(10,10,10,0.8)' }]}>
              <Text style={[styles.premiumText, { color: '#fff' }]}>FOLLOWERS</Text>
            </View>
          )}
          {spot.location_display_mode === 'approximate' && spot.privacy_mode !== 'private' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(96,165,250,0.9)', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <MapPin size={9} color="#fff" />
              <Text style={[styles.premiumText, { color: '#fff' }]}>APPROX</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={handleSave}
            style={styles.saveBtn}
            testID={testID ? `${testID}-save` : undefined}
          >
            <Bookmark size={18} color={spot.is_saved ? colors.primary : '#fff'} fill={spot.is_saved ? colors.primary : 'transparent'} />
          </TouchableOpacity>
        </View>
        <View style={styles.overlayBottom}>
          <ScoreBadge score={spot.shoot_score || 0} />
          <FreshnessBadge freshness={spot.freshness} label={spot.freshness_label} variant="compact" />
        </View>
      </View>

      <View style={styles.info}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>{spot.title}</Text>
          <VerifiedBadge status={spot.owner?.verification_status} variant="inline" size={14} />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.city} numberOfLines={1}>
            {spot.city}, {spot.state}
            {spot.distance_km != null ? ` · ${spot.distance_km}km` : ''}
          </Text>
        </View>
        <View style={styles.tagRow}>
          {(spot.shoot_types || []).slice(0, 2).map((t: string) => (
            <View key={t} style={styles.tag}>
              <Text style={styles.tagText}>{t}</Text>
            </View>
          ))}
          {spot.average_rating != null && (
            <View style={[styles.tag, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <Star size={10} color={colors.primary} fill={colors.primary} />
              <Text style={styles.tagText}>{spot.average_rating}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 4 / 5,
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  overlayTop: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    right: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  overlayBottom: {
    position: 'absolute',
    bottom: space.sm,
    left: space.sm,
    right: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  premiumBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
  },
  premiumText: {
    color: colors.textInverse,
    fontSize: 9,
    fontFamily: font.bodyBold,
    letterSpacing: 0.5,
  },
  saveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBadge: {
    borderWidth: 2,
    borderColor: colors.success,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,10,0.75)',
  },
  scoreText: {
    fontSize: 12,
    fontFamily: font.bodyBold,
  },
  info: {
    padding: space.md,
    gap: 6,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontFamily: font.bodySemibold,
    letterSpacing: -0.2,
  },
  metaRow: { flexDirection: 'row' },
  city: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: font.body,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: {
    backgroundColor: colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  tagText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: font.bodyMedium,
    letterSpacing: 0.4,
  },
});
