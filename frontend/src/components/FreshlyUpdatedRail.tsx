import React from 'react';
import { View, Text, StyleSheet, Image, Pressable, FlatList } from 'react-native';
import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import { timeAgo } from './FreshnessBits';

/**
 * Horizontal rail for the home feed showing spots with recent community
 * activity. Each card: thumbnail + title + city + "Updated 2h ago" +
 * freshness sparkle. Tap routes to the spot detail page.
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
      contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.md }}
      renderItem={({ item }) => {
        const cover = (item.images || []).find((i: any) => i?.is_cover) || item.images?.[0];
        const activityTs = item.last_activity_at || item._fresh_last_activity || item.latest_photo_at;
        return (
          <Pressable
            onPress={() => router.push(`/spot/${item.spot_id}` as any)}
            style={styles.card}
            testID={`fresh-spot-${item.spot_id}`}
          >
            <View style={styles.imgWrap}>
              {cover?.image_url ? (
                <Image source={{ uri: cover.image_url }} style={styles.img} />
              ) : (
                <View style={[styles.img, { backgroundColor: colors.surface2 }]} />
              )}
              <View style={styles.freshChip}>
                <Sparkles size={10} color={colors.textInverse} />
                <Text style={styles.freshChipTxt}>{timeAgo(activityTs) || 'Fresh'}</Text>
              </View>
            </View>
            <View style={{ padding: 10, gap: 4 }}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.meta} numberOfLines={1}>{item.city}{item.state ? `, ${item.state}` : ''}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: { width: 200, backgroundColor: colors.surface1, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  imgWrap: { position: 'relative' },
  img: { width: '100%', aspectRatio: 4 / 3 },
  freshChip: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(34,197,94,0.95)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: radii.pill },
  freshChipTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.3, textTransform: 'uppercase' },
  title: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
});
