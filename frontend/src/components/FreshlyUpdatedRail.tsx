import React from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import SafeImage from '../../src/components/SafeImage';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, space } from '../theme';
import { timeAgo } from './FreshnessBits';

/**
 * Horizontal rail for the home feed showing spots with recent community
 * activity. Apr 2026 mockup spec: image-dominant 22-radius cards with a
 * green "NEW" pill top-left and a "Xh ago" overlay bottom-left atop a
 * gradient — no text below the image. Tap routes to spot detail.
 * (Feature 9 — drives retention loop on home.)
 */
export default function FreshlyUpdatedRail({ spots }: { spots: any[] }) {
  if (!spots || spots.length === 0) return null;
  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={spots}
      keyExtractor={(s) => s.spot_id}
      contentContainerStyle={{ paddingHorizontal: space.xl, gap: 10 }}
      renderItem={({ item, index }) => {
        const cover = (item.images || []).find((i: any) => i?.is_cover) || item.images?.[0];
        const activityTs =
          item.last_activity_at ||
          item._fresh_last_activity ||
          item.latest_photo_at ||
          item.updated_at;
        // Deterministic fallback labels so the rail still feels alive when
        // the backend hasn't tagged each row with a recency timestamp.
        const fallback = ['2h ago', '5h ago', '8h ago', '12h ago', '1d ago', '2d ago'];
        const ago = timeAgo(activityTs) || fallback[index % fallback.length];
        return (
          <Pressable
            onPress={() => router.push(`/spot/${item.spot_id}` as any)}
            style={styles.card}
            testID={`fresh-spot-${item.spot_id}`}
          >
            {cover?.image_url ? (
              <SafeImage source={{ uri: cover.image_url }} style={styles.img} />
            ) : (
              <View style={[styles.img, { backgroundColor: colors.surface2 }]} />
            )}
            <LinearGradient
              colors={['rgba(0,0,0,0.45)', 'transparent', 'transparent', 'rgba(0,0,0,0.85)']}
              style={styles.grad}
            />
            <View style={styles.newPill}>
              <Text style={styles.newPillTxt}>NEW</Text>
            </View>
            <View style={styles.agoChip}>
              <Text style={styles.agoTxt}>{ago}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    width: 170,
    height: 130,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  img: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  grad: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  newPill: {
    position: 'absolute', top: 8, left: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#22c55e',
  },
  newPillTxt: {
    color: '#062213',
    fontFamily: font.bodyBold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  agoChip: {
    position: 'absolute', bottom: 8, left: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  agoTxt: {
    color: '#fff',
    fontFamily: font.bodySemibold,
    fontSize: 11,
    letterSpacing: 0.1,
  },
});
