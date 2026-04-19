import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Easing, ViewStyle } from 'react-native';
import { colors, radii, space } from '../theme';

function useShimmer() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      })
    ).start();
  }, [anim]);
  return anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
}

export function SkeletonBox({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const opacity = useShimmer();
  return <Animated.View style={[styles.box, style, { opacity }]} />;
}

export function SpotCardSkeleton({ width = 240 }: { width?: number | '100%' }) {
  return (
    <View style={[styles.card, { width } as any]}>
      <SkeletonBox style={{ width: '100%', aspectRatio: 4 / 5 } as any} />
      <View style={{ padding: space.md, gap: 8 }}>
        <SkeletonBox style={{ height: 14, width: '80%' }} />
        <SkeletonBox style={{ height: 10, width: '50%' }} />
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          <SkeletonBox style={{ height: 16, width: 50, borderRadius: radii.pill }} />
          <SkeletonBox style={{ height: 16, width: 40, borderRadius: radii.pill }} />
        </View>
      </View>
    </View>
  );
}

export function SectionSkeleton() {
  return (
    <View style={{ marginTop: space.xl }}>
      <View style={{ paddingHorizontal: space.xl, marginBottom: space.md }}>
        <SkeletonBox style={{ height: 22, width: 200 }} />
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: space.xl, gap: space.md }}>
        <SpotCardSkeleton />
        <SpotCardSkeleton />
      </View>
    </View>
  );
}

export function DetailSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SkeletonBox style={{ width: '100%', aspectRatio: 1 }} />
      <View style={{ padding: space.xl, gap: 12 }}>
        <SkeletonBox style={{ height: 32, width: '80%' }} />
        <SkeletonBox style={{ height: 14, width: '50%' }} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <SkeletonBox style={{ height: 22, width: 70, borderRadius: radii.pill }} />
          <SkeletonBox style={{ height: 22, width: 90, borderRadius: radii.pill }} />
        </View>
        <SkeletonBox style={{ height: 80, width: '100%', marginTop: 16 }} />
        <SkeletonBox style={{ height: 120, width: '100%', marginTop: 12 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface2,
    borderRadius: radii.sm,
  },
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
