import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Pressable, Platform } from 'react-native';
import { router } from 'expo-router';
import { Bookmark, Star, Shield, Lock, EyeOff, MapPin, Sun, MoreVertical, TrendingUp, Sparkles, ShieldCheck } from 'lucide-react-native';
import { colors, radii, space, font } from '../theme';
import { api } from '../api';
import { useAuth } from '../auth';
import FreshnessBadge from './FreshnessBadge';
import VerifiedBadge from './VerifiedBadge';
import AdminSpotMenu from './AdminSpotMenu';
import SpotImageFallback from './SpotImageFallback';
import { goldenHourLabel } from '../utils/sun';

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
  onAfterAdminAction,
  width,
  testID,
}: {
  spot: Spot;
  onPress?: () => void;
  onToggleSave?: () => void;
  onAfterAdminAction?: () => void;
  width?: number | string;
  testID?: string;
}) {
  const { user } = useAuth();
  const isAdmin = !!user && (user.role === 'admin' || user.role === 'super_admin');
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Cover priority:
  //   1. hero_cover_image_url (when admin_override OR rotation stack decided it)
  //   2. spot.images[].is_cover=true
  //   3. spot.images[0]
  //
  // PRIORITY FIX: hero_cover_image_url must win when present — otherwise
  // an admin-pinned cover never shows on Explore because images[0] beats it.
  const rawCover =
    spot.hero_cover_image_url
    || (spot.images && (spot.images.find((i: any) => i.is_cover) || spot.images[0]))?.image_url;
  const cover = rawCover && typeof rawCover === 'string' && rawCover.trim() !== '' ? rawCover : null;
  const isPremium = spot.privacy_mode === 'premium';
  const isHydrated = !!spot?.title;

  const handlePress = () => {
    if (onPress) return onPress();
    router.push(`/spot/${spot.spot_id}`);
  };

  const handleLongPress = () => {
    if (isAdmin) setAdminMenuOpen(true);
  };

  const handleSave = async (e: any) => {
    e?.stopPropagation?.();
    try {
      await api.post(`/spots/${spot.spot_id}/save`);
      onToggleSave?.();
    } catch {}
  };

  // Build discovery badges — max 2 rendered, priority: TRENDING > NEW > FRESH > VERIFIED
  const badges: { kind: string; label: string; color: string; icon: any }[] = [];
  if (spot.is_trending) badges.push({ kind: 'trending', label: 'TRENDING', color: colors.primary, icon: TrendingUp });
  if (spot.is_new) badges.push({ kind: 'new', label: 'NEW', color: colors.success, icon: Sparkles });
  if (spot.is_fresh && !spot.is_new) badges.push({ kind: 'fresh', label: 'FRESH', color: '#3b82f6', icon: Sparkles });
  if (spot.is_verified_discovery) badges.push({ kind: 'verified', label: 'VERIFIED', color: colors.success, icon: ShieldCheck });
  const visibleBadges = badges.slice(0, 2);

  return (
    <>
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={400}
      style={[styles.card, { width: width ?? '100%' }]}
      testID={testID}
    >
      <View style={styles.imageWrap}>
        {cover && !imgError ? (
          <Image
            source={{ uri: cover }}
            style={styles.image}
            onError={() => setImgError(true)}
          />
        ) : (
          <SpotImageFallback
            title={spot.title}
            shootType={spot.shoot_types?.[0]}
            seed={spot.spot_id || spot.title}
            style={styles.image}
          />
        )}
        <View style={styles.overlayTop}>
          {isHydrated && isAdmin && (
            <View style={styles.adminChip}>
              <Text style={styles.adminChipTxt}>🛠 ADMIN</Text>
            </View>
          )}
          {isHydrated && isPremium && (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumText}>PREMIUM</Text>
            </View>
          )}
          {isHydrated && spot.privacy_mode === 'private' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(10,10,10,0.8)', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <Lock size={9} color="#fff" />
              <Text style={[styles.premiumText, { color: '#fff' }]}>PRIVATE</Text>
            </View>
          )}
          {isHydrated && spot.privacy_mode === 'followers' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(10,10,10,0.8)' }]}>
              <Text style={[styles.premiumText, { color: '#fff' }]}>FOLLOWERS</Text>
            </View>
          )}
          {isHydrated && spot.location_display_mode === 'approximate' && spot.privacy_mode !== 'private' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(96,165,250,0.9)', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <MapPin size={9} color="#fff" />
              <Text style={[styles.premiumText, { color: '#fff' }]}>APPROX</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {isHydrated && isAdmin && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); setAdminMenuOpen(true); }}
              style={styles.kebabBtn}
              testID={testID ? `${testID}-admin` : 'spot-admin-menu'}
              hitSlop={6}
            >
              <MoreVertical size={16} color="#fff" />
            </TouchableOpacity>
          )}
          {isHydrated && (
            <TouchableOpacity
              onPress={handleSave}
              style={styles.saveBtn}
              testID={testID ? `${testID}-save` : undefined}
            >
              <Bookmark size={18} color={spot.is_saved ? colors.primary : '#fff'} fill={spot.is_saved ? colors.primary : 'transparent'} />
            </TouchableOpacity>
          )}
        </View>

        {/* Discovery badges — max 2, top of image stacked below the top row */}
        {isHydrated && visibleBadges.length > 0 && (
          <View style={styles.discoveryRow}>
            {visibleBadges.map((b) => {
              const Icon = b.icon;
              return (
                <View key={b.kind} style={[styles.discoveryBadge, { borderColor: b.color, backgroundColor: colorHex(b.color, 0.85) }]}>
                  <Icon size={9} color="#fff" strokeWidth={2.5} />
                  <Text style={styles.discoveryBadgeTxt}>{b.label}</Text>
                </View>
              );
            })}
          </View>
        )}

        {isHydrated && (
          <View style={styles.overlayBottom}>
            <ScoreBadge score={spot.shoot_score || 0} />
            <FreshnessBadge freshness={spot.freshness} label={spot.freshness_label} variant="compact" />
            {!!goldenHourLabel(spot.latitude, spot.longitude) && (
              <View style={styles.goldenPill}>
                <Sun size={10} color={colors.primary} />
                <Text style={styles.goldenPillTxt} numberOfLines={1}>
                  {goldenHourLabel(spot.latitude, spot.longitude)}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      <View style={styles.info}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.title, { flex: 1 }]} numberOfLines={1}>{spot.title}</Text>
          <VerifiedBadge status={spot.owner?.verification_status} variant="inline" size={14} />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.city} numberOfLines={1}>
            {spot.city}, {spot.state}
            {spot.distance_mi != null ? ` · ${spot.distance_mi} mi` : spot.distance_km != null ? ` · ${spot.distance_km} km` : ''}
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
    {isAdmin && (
      <AdminSpotMenu
        visible={adminMenuOpen}
        spot={spot}
        role={user.role}
        onClose={() => setAdminMenuOpen(false)}
        onAfterChange={() => onAfterAdminAction?.()}
      />
    )}
    </>
  );
}

function colorHex(hex: string, alpha: number) {
  if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return `rgba(245,166,35,${alpha})`;
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }
      : {
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        }),
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
    gap: 5,
  },
  adminChip: {
    backgroundColor: 'rgba(245,166,35,0.9)',
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.primary,
  },
  adminChipTxt: { color: '#0A0A0A', fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.8 },
  kebabBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  discoveryRow: {
    position: 'absolute',
    top: space.sm + 32,
    left: space.sm,
    flexDirection: 'row', gap: 4, flexWrap: 'wrap',
    maxWidth: '75%',
  },
  discoveryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  discoveryBadgeTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  overlayBottom: {
    position: 'absolute',
    bottom: space.sm,
    left: space.sm,
    right: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  goldenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(20,16,8,0.78)',
    borderColor: 'rgba(245,166,35,0.55)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  goldenPillTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 0.3,
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
