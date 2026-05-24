/**
 * SafeClusteredMapView — STABILITY REWRITE (Nov 2026)
 * ====================================================
 *
 * IMPORTANT: This file used to wrap `react-native-map-clustering` with
 * defensive guards. As of the Nov-2026 stability mandate, ALL clustering
 * is removed from LumaScout. This module is now a thin pass-through to
 * the plain `react-native-maps` `MapView`, retained ONLY so the rest of
 * the codebase doesn't need to change its imports.
 *
 * Why keep the file at all?
 *   · Explore screen + other map surfaces import the same component name.
 *   · Future map-stability tweaks (region clamping, NaN drops, debounce)
 *     can live here without touching every consumer.
 *
 * What this file does NOT do (and never will until explicit re-approval):
 *   · Aggregate markers into bubbles.
 *   · Pull in `supercluster` / `react-native-map-clustering`.
 *   · Render cluster icons or honor `clusterColor` / `renderCluster`.
 *
 * Any cluster-related props passed by callers are silently dropped, so
 * the existing call sites compile but produce zero clustering at runtime.
 *
 * Defensive guards retained from the prior implementation:
 *   · onRegionChangeComplete drops events with NaN / Infinity / out-of-
 *     range deltas (prevented gesture-interruption crashes on iOS).
 *   · Clamps lat/lng deltas to a safe minimum so downstream consumers
 *     never receive zero / negative deltas.
 */
import React, { forwardRef, useCallback } from 'react';
import { MapView as PlainMapView } from './maps-module';
import { exploreLog } from '../utils/spot-geo';

/** Minimum delta guard — negative or zero deltas from iOS gesture
 *  interruptions can crash native map engines. */
const MIN_DELTA = 0.0005;

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const isValidRegion = (r: any): r is Region => {
  if (!r) return false;
  for (const k of ['latitude', 'longitude', 'latitudeDelta', 'longitudeDelta']) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  if (r.latitude < -90 || r.latitude > 90) return false;
  if (r.longitude < -180 || r.longitude > 180) return false;
  if (r.latitudeDelta <= 0 || r.longitudeDelta <= 0) return false;
  return true;
};

const clampRegion = (r: Region): Region => ({
  latitude: Math.max(-90, Math.min(90, r.latitude)),
  longitude: Math.max(-180, Math.min(180, r.longitude)),
  latitudeDelta: Math.max(MIN_DELTA, Math.min(180, r.latitudeDelta)),
  longitudeDelta: Math.max(MIN_DELTA, Math.min(360, r.longitudeDelta)),
});

interface Props {
  onRegionChangeComplete?: (region: Region) => void;
  // Catch-all so cluster-shaped props pass through TS without errors.
  [key: string]: any;
}

const SafeClusteredMapView = forwardRef<any, Props>(function SafeClusteredMapView(
  props,
  ref,
) {
  const {
    onRegionChangeComplete,
    // Discard any cluster-* props the caller may still be passing — we
    // ignore them deliberately to enforce the "no clustering" stance.
    clusterColor: _clusterColor,
    clusterTextColor: _clusterTextColor,
    clusterFontFamily: _clusterFontFamily,
    clusterFontSize: _clusterFontSize,
    clusterStrokeColor: _clusterStrokeColor,
    clusterStrokeWidth: _clusterStrokeWidth,
    clusterContainerStyle: _clusterContainerStyle,
    renderCluster: _renderCluster,
    spiralEnabled: _spiralEnabled,
    spiderLineColor: _spiderLineColor,
    radius: _radius,
    maxZoom: _maxZoom,
    minZoom: _minZoom,
    extent: _extent,
    nodeSize: _nodeSize,
    edgePadding: _edgePadding,
    animationEnabled: _animationEnabled,
    clusteringEnabled: _clusteringEnabled,
    superClusterRef: _superClusterRef,
    onClusterPress: _onClusterPress,
    ...rest
  } = props;

  const handleRegionChange = useCallback(
    (region: Region) => {
      if (!onRegionChangeComplete) return;
      if (!isValidRegion(region)) {
        try {
          exploreLog('warn', 'map_region_dropped_invalid', { region });
        } catch {}
        return;
      }
      try {
        onRegionChangeComplete(clampRegion(region));
      } catch (e) {
        try {
          exploreLog('warn', 'map_region_callback_threw', {
            err: String((e as any)?.message || e),
          });
        } catch {}
      }
    },
    [onRegionChangeComplete],
  );

  if (!PlainMapView) {
    // Web stub or missing native module — render nothing rather than crash.
    return null;
  }

  return (
    <PlainMapView ref={ref} onRegionChangeComplete={handleRegionChange} {...rest} />
  );
});

export default SafeClusteredMapView;
