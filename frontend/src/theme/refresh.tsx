/**
 * Branded pull-to-refresh + "Updated just now" toast helper.
 *
 * Why this exists
 * ────────────────
 * CR Item 11 (May 2026) — every list/feed surface gets a native
 * pull-to-refresh in the LumaScout amber. We don't want to wire
 * RefreshControl props by hand on every screen, so we centralise:
 *
 *   • <BrandedRefreshControl onRefresh={fn} refreshing={bool} />
 *     A drop-in `<RefreshControl>` with the brand amber tint applied,
 *     correct iOS/Android colour split, and a 200ms minimum spinner so
 *     refreshes don't feel "fake-fast" (a sub-100ms refresh that flashes
 *     the spinner for 1 frame looks broken).
 *
 *   • useBrandedRefresh({ load, isChanged })
 *     Hook that wraps an async loader. Shows a transient "Updated just
 *     now" banner ONLY when the loader returned new data (per the
 *     consumer-supplied `isChanged` predicate). If nothing changed we
 *     stay silent — a toast on every pull would be noise.
 *
 * Haptics
 * ───────
 * iOS gets a soft "selection" haptic on pull-trigger. Android gets
 * nothing (Android haptics on overscroll are jarring). Both rely on
 * the OS-native bounce animation; we don't fake it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, RefreshControl, RefreshControlProps, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from './colors';
import { font } from './fonts';

const AMBER = '#F5A524';

// ── <BrandedRefreshControl /> ──────────────────────────────────────
export function BrandedRefreshControl(props: Partial<RefreshControlProps> & { onRefresh: () => void; refreshing: boolean }) {
  const wrappedOnRefresh = useCallback(() => {
    if (Platform.OS === 'ios') {
      Haptics.selectionAsync().catch(() => {});
    }
    props.onRefresh();
  }, [props]);

  return (
    <RefreshControl
      // iOS pulls the colour from `tintColor`. Android pulls the spinner
      // arc colours from `colors`. Both must be set or one platform shows
      // the system grey ring.
      tintColor={AMBER}
      colors={[AMBER]}
      // The progress label only renders on iOS but adds polish for users
      // who pause mid-pull.
      title={Platform.OS === 'ios' ? 'Refreshing…' : undefined}
      titleColor={colors.subtleText}
      progressBackgroundColor={colors.surface1}
      {...props}
      onRefresh={wrappedOnRefresh}
    />
  );
}

// ── useBrandedRefresh hook ─────────────────────────────────────────
type RefreshOptions<T> = {
  /** Async fetcher. Should return the new data (used for isChanged compare). */
  load: () => Promise<T>;
  /**
   * Predicate that decides whether the toast fires. If you don't pass
   * one, the toast fires on every successful refresh.
   * Receives (oldSnapshot, newSnapshot).
   */
  isChanged?: (prev: T | null, next: T) => boolean;
  /** Minimum spinner duration (ms). Prevents instant flash. */
  minSpin?: number;
};

export function useBrandedRefresh<T>({ load, isChanged, minSpin = 220 }: RefreshOptions<T>) {
  const [refreshing, setRefreshing] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const lastSnapshot = useRef<T | null>(null);

  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const start = Date.now();
    try {
      const next = await load();
      const changed = isChanged ? isChanged(lastSnapshot.current, next) : true;
      lastSnapshot.current = next;
      // Only fire the toast if data actually changed.
      if (changed) {
        setToastVisible(true);
      }
    } catch {
      // Silent — surface is up to the consumer's existing error UI.
    } finally {
      const elapsed = Date.now() - start;
      const wait = Math.max(0, minSpin - elapsed);
      setTimeout(() => setRefreshing(false), wait);
    }
  }, [refreshing, load, isChanged, minSpin]);

  // Toast fade in/out
  useEffect(() => {
    if (!toastVisible) return;
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(toastOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setToastVisible(false));
  }, [toastVisible, toastOpacity]);

  const Toast = useCallback(() => {
    if (!toastVisible) return null;
    return (
      <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastOpacity }]}>
        <View style={styles.toastInner}>
          <Text style={styles.toastText}>Updated just now</Text>
        </View>
      </Animated.View>
    );
  }, [toastVisible, toastOpacity]);

  return { refreshing, onRefresh, Toast };
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  toastInner: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1f1f1f',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,165,36,0.35)',
  },
  toastText: {
    color: AMBER,
    fontFamily: font.bodyBold,
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
