/**
 * Network tab — premium 3-mode shell (Discover · Directory · Community).
 *
 *   Apr 2026 redesign — unified system with compact header, sticky
 *   premium segmented switch (sliding white indicator), lazy mount
 *   per tab, and preserved scroll state.
 *
 *   Tabs:
 *     • Discover  → DiscoverPremiumView
 *     • Directory → DirectoryView
 *     • Community → CommunityView
 *
 *   Lazy mount: only the active tab's component is initialised on first
 *   render. After visiting a tab once, it stays mounted under an absolutely
 *   positioned, opacity-0 + pointerEvents="none" wrapper so scroll state
 *   is preserved when the user toggles back.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Share, Animated, Easing, LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserPlus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { colors, font, space } from '../../src/theme';
import DirectoryView from '../../src/components/DirectoryView';
import DiscoverPremiumView from '../../src/components/DiscoverPremiumView';
import CommunityView from '../../src/components/CommunityView';

type ViewKey = 'discover' | 'directory' | 'community';

const TABS: { key: ViewKey; label: string }[] = [
  { key: 'discover',  label: 'Discover'  },
  { key: 'directory', label: 'Directory' },
  { key: 'community', label: 'Community' },
];

const COPY: Record<ViewKey, { title: string; subtitle: string }> = {
  discover:  { title: 'Discover photographers', subtitle: 'Find creators, collaborators, and opportunities near you.' },
  directory: { title: 'Browse photographers',   subtitle: 'Browse creators near you and across specialties.' },
  community: { title: 'Community',              subtitle: 'Connect with photographers — share, ask, refer.' },
};

export default function NetworkTab() {
  const [view, setView] = useState<ViewKey>('discover');
  const [mounted, setMounted] = useState<Record<ViewKey, boolean>>({
    discover: true, directory: false, community: false,
  });

  // Sliding indicator for segmented switch
  const [trackW, setTrackW] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorIdx = TABS.findIndex((t) => t.key === view);

  useEffect(() => {
    if (trackW <= 0) return;
    const segW = (trackW - 6) / TABS.length;
    const target = 3 + indicatorIdx * segW;
    Animated.timing(indicatorX, {
      toValue: target,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [indicatorIdx, trackW, indicatorX]);

  // Fade animation per tab body
  const fadeMap = useRef<Record<ViewKey, Animated.Value>>({
    discover:  new Animated.Value(1),
    directory: new Animated.Value(0),
    community: new Animated.Value(0),
  }).current;

  const switchTo = (next: ViewKey) => {
    if (next === view) return;
    Haptics.selectionAsync().catch(() => {});
    // Lazy-mount the destination if first visit
    if (!mounted[next]) setMounted((m) => ({ ...m, [next]: true }));
    // Cross-fade: prev → out, next → in (slight delay so DOM mounts)
    Animated.parallel([
      Animated.timing(fadeMap[view], {
        toValue: 0, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(fadeMap[next], {
        toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();
    setView(next);
  };

  const onShareApp = async () => {
    Haptics.selectionAsync().catch(() => {});
    try {
      await Share.share({
        message:
          'Join me on LumaScout — find amazing photo spots, connect with photographers 📸\n\nhttps://lumascout.app',
        url: 'https://lumascout.app',
        title: 'LumaScout',
      });
    } catch {}
  };

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== trackW) setTrackW(w);
  };

  const c = COPY[view];

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      {/* Compact premium header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>NETWORK</Text>
          <Text style={s.title}>{c.title}</Text>
          <Text style={s.subtitle} numberOfLines={1}>{c.subtitle}</Text>
        </View>
        <Pressable
          onPress={onShareApp}
          style={({ pressed }) => [s.inviteBtn, pressed && s.inviteBtnPressed]}
          hitSlop={6}
          testID="network-share-app"
        >
          <UserPlus size={17} color={colors.primary} />
        </Pressable>
      </View>

      {/* Sticky premium segmented switch — 3 equal columns + sliding indicator */}
      <View style={s.segWrap}>
        <View style={s.segTrack} onLayout={onTrackLayout}>
          {trackW > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                s.segIndicator,
                {
                  width: (trackW - 6) / TABS.length,
                  transform: [{ translateX: indicatorX }],
                },
              ]}
            />
          ) : null}
          {TABS.map((t) => {
            const active = view === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => switchTo(t.key)}
                style={s.segBtn}
                testID={`network-view-${t.key}`}
              >
                <Text style={[s.segBtnTxt, active && s.segBtnTxtActive]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Lazy-mounted, fade-cross-faded body — preserves scroll state per tab */}
      <View style={s.body}>
        {mounted.discover ? (
          <Animated.View
            style={[s.layer, { opacity: fadeMap.discover }]}
            pointerEvents={view === 'discover' ? 'auto' : 'none'}
          >
            <DiscoverPremiumView />
          </Animated.View>
        ) : null}
        {mounted.directory ? (
          <Animated.View
            style={[s.layer, { opacity: fadeMap.directory }]}
            pointerEvents={view === 'directory' ? 'auto' : 'none'}
          >
            <DirectoryView />
          </Animated.View>
        ) : null}
        {mounted.community ? (
          <Animated.View
            style={[s.layer, { opacity: fadeMap.community }]}
            pointerEvents={view === 'community' ? 'auto' : 'none'}
          >
            <CommunityView />
          </Animated.View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Header — tight, premium
  header: {
    paddingHorizontal: space.xl,
    paddingTop: 4,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  kicker: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1.0,
  },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 24,
    marginTop: 1,
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 16,
  },
  inviteBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.38)',
    marginTop: 8,
  },
  inviteBtnPressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },

  // Segmented switch
  segWrap: {
    paddingHorizontal: space.xl,
    paddingTop: 10,
    paddingBottom: 12,
  },
  segTrack: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segIndicator: {
    position: 'absolute',
    left: 0,
    top: 3, bottom: 3,
    borderRadius: 16,
    backgroundColor: colors.text,
  },
  segBtn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segBtnTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodySemibold,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  segBtnTxtActive: {
    color: colors.bg,
    fontFamily: font.bodyBold,
  },

  // Body — absolute-positioned layers preserve scroll state
  body: { flex: 1 },
  layer: { ...StyleSheet.absoluteFillObject },
});
