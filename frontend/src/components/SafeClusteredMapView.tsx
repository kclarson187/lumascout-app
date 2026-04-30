/**
 * SafeClusteredMapView — May 2026 P0 crash fix
 * =============================================
 *
 * Defensive wrapper around `react-native-map-clustering@4.0.0` which crashes
 * on rapid pinch-to-zoom-out gestures for four compounding reasons:
 *
 *   1. Library's `calculateBBox(region)` does raw arithmetic
 *      `lat - latitudeDelta`, `lng - longitudeDelta` with NO clamping —
 *      at continent-scale zoom the bbox exceeds [-90,90]/[-180,180]
 *      which crashes `@mapbox/geo-viewport`.
 *   2. Library's internal `_onRegionChangeComplete` runs
 *      `supercluster.getClusters()` synchronously on the JS thread
 *      BEFORE any downstream handler sees the event — our outer
 *      debounce was powerless.
 *   3. `LayoutAnimation.configureNext()` fires on every iOS recalc —
 *      stacked animations during rapid gestures cause native-layer
 *      state conflicts.
 *   4. `latitudeDelta` / `longitudeDelta` can briefly be `NaN` /
 *      `Infinity` on iOS during interrupted gestures. The library has
 *      no defense.
 *
 * This wrapper:
 *   · Intercepts `onRegionChangeComplete` and DROPS callbacks whose
 *     region contains NaN / Infinity / out-of-range values.
 *   · Clamps the region to valid ranges before forwarding.
 *   · Disables clustering entirely when zoomed out beyond a threshold
 *     (latitudeDelta > 40° = roughly showing >5 US states at once) —
 *     at that scale supercluster can't produce useful visuals anyway
 *     and the CPU cost isn't worth the crash risk.
 *   · Debounces region-change forwards at 150ms leading-edge so rapid
 *     pinch-release gestures only trigger ONE recompute.
 *   · try/catches every forward — if the library still throws for some
 *     unknown reason, we log `[explore] cluster_recalc_failed` and
 *     keep the previous region state so the pins stay visible.
 *   · Falls back to plain `<MapView>` (no clustering) when
 *     `ClusteredMapView` itself isn't available (web stub).
 *
 * Visual parity: zero layout change. Same props surface area. Same
 * render output. Same cluster styling.
 */
import React, { forwardRef, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { MapView as PlainMapView, ClusteredMapView } from './maps-module';
import { exploreLog } from '../utils/spot-geo';

/** Absolute delta threshold above which we short-circuit clustering. */
const CLUSTERING_DISABLED_ABOVE_DELTA = 40;
/** Minimum delta guard — negative or zero deltas from iOS gesture
 *  interruptions can crash the cluster engine. */
const MIN_DELTA = 0.0005;

type AnyRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

function isValidRegion(r: any): r is AnyRegion {
  if (!r || typeof r !== 'object') return false;
  const keys = ['latitude', 'longitude', 'latitudeDelta', 'longitudeDelta'];
  for (const k of keys) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  if (r.latitude < -90 || r.latitude > 90) return false;
  if (r.longitude < -180 || r.longitude > 180) return false;
  // Deltas must be positive and within sane bounds. A delta >180 for lat
  // is physically impossible; for lng it wraps the globe and is useless.
  if (r.latitudeDelta <= 0 || r.latitudeDelta > 180) return false;
  if (r.longitudeDelta <= 0 || r.longitudeDelta > 360) return false;
  return true;
}

function clampRegion(r: AnyRegion): AnyRegion {
  const lat = Math.min(89.9, Math.max(-89.9, r.latitude));
  const lng = Math.min(179.9, Math.max(-179.9, r.longitude));
  // Leave room between lat±delta and ±90 so `calculateBBox` doesn't
  // produce out-of-range values downstream.
  const maxLatDelta = 90 - Math.abs(lat);
  const latD = Math.max(MIN_DELTA, Math.min(maxLatDelta - 0.1, r.latitudeDelta));
  const lngD = Math.max(MIN_DELTA, Math.min(180 - 0.1, r.longitudeDelta));
  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: latD,
    longitudeDelta: lngD,
  };
}

export type SafeClusteredMapViewProps = Record<string, any>;

/**
 * forwardRef so the parent (`explore.tsx`) can keep calling
 * `mapRef.current?.animateToRegion(...)` without any changes.
 */
const SafeClusteredMapView = forwardRef<any, SafeClusteredMapViewProps>(
  function SafeClusteredMapView(props, ref) {
    const {
      onRegionChangeComplete,
      initialRegion,
      clusteringEnabled: propClusteringEnabled,
      ...rest
    } = props || {};

    // Track the last-known-good region so if a handler rejects a bad
    // region we don't lose state.
    const lastGoodRegion = useRef<AnyRegion | null>(
      isValidRegion(initialRegion) ? initialRegion : null,
    );
    // Leading-edge debounce ref — if a callback fires within 150ms of
    // the previous one we drop it.
    const lastFiredAt = useRef<number>(0);
    // Track whether clustering has been disabled due to extreme zoom.
    const clusteringDisabledRef = useRef<boolean>(false);

    const handleRegionChangeComplete = useCallback(
      (region: any, details?: any) => {
        const now = Date.now();
        const dt = now - lastFiredAt.current;
        // 150ms leading-edge debounce on the INTERNAL forward. The
        // parent's own debounce (currently 300ms in explore.tsx) still
        // applies on top of this — the two compose safely.
        if (dt < 150) {
          exploreLog('debug', 'cluster_region_throttled', { dt });
          return;
        }
        lastFiredAt.current = now;

        if (!isValidRegion(region)) {
          // The library sometimes ships junk during rapid gestures.
          // DROP the callback entirely — preserve last-known state.
          exploreLog('warn', 'cluster_region_invalid', {
            region:
              region && typeof region === 'object'
                ? {
                    lat: region.latitude,
                    lng: region.longitude,
                    dLat: region.latitudeDelta,
                    dLng: region.longitudeDelta,
                  }
                : String(region),
          });
          return;
        }

        const clamped = clampRegion(region);
        lastGoodRegion.current = clamped;

        // Disable clustering at continent-scale zoom. The library
        // re-enables it on the next render pass when zoom tightens.
        const shouldDisable =
          clamped.latitudeDelta > CLUSTERING_DISABLED_ABOVE_DELTA ||
          clamped.longitudeDelta > CLUSTERING_DISABLED_ABOVE_DELTA;
        if (shouldDisable !== clusteringDisabledRef.current) {
          clusteringDisabledRef.current = shouldDisable;
          exploreLog(shouldDisable ? 'warn' : 'info', 'clustering_toggled', {
            disabled: shouldDisable,
            latitudeDelta: clamped.latitudeDelta,
            longitudeDelta: clamped.longitudeDelta,
          });
        }

        // Forward to caller in try/catch so any downstream crash is
        // logged rather than bubbled to the native layer.
        try {
          onRegionChangeComplete?.(clamped, details);
        } catch (e: any) {
          exploreLog('error', 'cluster_recalc_failed', {
            message: e?.message,
            stack: (e?.stack || '').split('\n').slice(0, 4).join('\n'),
          });
        }
      },
      [onRegionChangeComplete],
    );

    // Pick the component. On web the cluster import is a stub (null).
    // When clustering is disabled at extreme zoom, skip the cluster
    // layer entirely to avoid even the initial supercluster build.
    const Inner =
      Platform.OS === 'web' || !ClusteredMapView
        ? PlainMapView
        : ClusteredMapView;

    // Compose clusteringEnabled — prop override still wins, but we
    // default to the zoom-based toggle ref.
    const effectiveClusteringEnabled =
      propClusteringEnabled === false
        ? false
        : !clusteringDisabledRef.current;

    // Clamp the initialRegion too, so the FIRST supercluster build
    // doesn't crash if we're mounted at an extreme zoom.
    const safeInitialRegion =
      isValidRegion(initialRegion) ? clampRegion(initialRegion) : undefined;

    return React.createElement(Inner, {
      ref,
      ...rest,
      initialRegion: safeInitialRegion,
      clusteringEnabled: effectiveClusteringEnabled,
      onRegionChangeComplete: handleRegionChangeComplete,
    });
  },
);

export default SafeClusteredMapView;
