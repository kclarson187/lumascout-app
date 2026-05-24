/**
 * SafeMapView — STABILITY HARDENING (Nov 2026 Phase 2)
 * ====================================================
 *
 * This file replaces SafeClusteredMapView. The old name is preserved
 * as a thin re-export (SafeClusteredMapView.tsx) so any in-flight
 * branches don't break, but ALL new code MUST import from here.
 *
 * What this is:
 *   · Thin pass-through to react-native-maps' `MapView`.
 *   · Region clamp + NaN-drop guards on onRegionChangeComplete.
 *   · In __DEV__, warns ONCE if any cluster-* prop is passed (helps
 *     catch stragglers from the deprecated clustering era).
 *   · In production, simply ignores cluster-* props (no behavior).
 *
 * What this is NOT:
 *   · NOT a clustering wrapper. No `react-native-map-clustering`.
 *   · NOT a marker aggregator. No `supercluster`.
 *   · NOT a spiderfy / cluster-tap-zoom helper.
 *
 * Re-introducing clustering here requires an explicit product decision
 * AND a revisit of the crash class that originally caused the removal.
 */
import React, { forwardRef, useCallback, useRef } from 'react';
import { MapView as PlainMapView } from './maps-module';
import { exploreLog } from '../utils/spot-geo';
import { clampRegion, isValidRegion, SafeRegion } from '../utils/map-safety';

// One-shot dev warning if a caller still passes cluster-shaped props.
const _devWarnedKeys = new Set<string>();
const CLUSTER_PROP_KEYS = [
  'clusterColor', 'clusterTextColor', 'clusterFontFamily', 'clusterFontSize',
  'clusterStrokeColor', 'clusterStrokeWidth', 'clusterContainerStyle',
  'renderCluster', 'spiralEnabled', 'spiderLineColor', 'radius',
  'maxZoom', 'minZoom', 'extent', 'nodeSize', 'edgePadding',
  'animationEnabled', 'clusteringEnabled', 'superClusterRef', 'onClusterPress',
] as const;

interface Props {
  onRegionChangeComplete?: (region: SafeRegion) => void;
  [key: string]: any;
}

const SafeMapView = forwardRef<any, Props>(function SafeMapView(props, ref) {
  const { onRegionChangeComplete, ...rest } = props;

  // Strip cluster-* props before forwarding so the underlying native
  // MapView never sees them. In dev, emit a one-shot warning so the
  // caller knows to clean up.
  const passthroughProps: Record<string, any> = {};
  if (__DEV__) {
    for (const key of CLUSTER_PROP_KEYS) {
      if (key in rest && !_devWarnedKeys.has(key)) {
        _devWarnedKeys.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[SafeMapView] Ignoring cluster-shaped prop '${key}'. ` +
          'Clustering was removed for stability — drop this prop from your call site.',
        );
      }
    }
  }
  for (const k of Object.keys(rest)) {
    if ((CLUSTER_PROP_KEYS as readonly string[]).includes(k)) continue;
    passthroughProps[k] = rest[k];
  }

  const handleRegionChange = useCallback(
    (region: any) => {
      if (!onRegionChangeComplete) return;
      if (!isValidRegion(region)) {
        try { exploreLog('warn', 'map_region_dropped_invalid', { region }); } catch {}
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
    // Web stub / missing native module — render nothing rather than crash.
    return null;
  }

  return (
    <PlainMapView ref={ref} onRegionChangeComplete={handleRegionChange} {...passthroughProps} />
  );
});

export default SafeMapView;
