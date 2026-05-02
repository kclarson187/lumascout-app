# TODO — Revisit `newArchEnabled: true`

**Status:** disabled in `/app/frontend/app.json` as of 2.0.23 (2026-05-02).

## Why we disabled it

TestFlight v2.0.22 with `newArchEnabled: true` crashed on every iOS pinch-zoom
with:

```
Exception: NSInvalidArgumentException
Reason:    *** -[__NSArrayM insertObject:atIndex:]: object cannot be nil
Stack:
  -[__NSArrayM insertObject:atIndex:]
  -[RCTLegacyViewManagerInteropComponentView finalizeUpdates:]
  -[RCTMountingManager performTransaction:]
```

Root cause: Fabric's legacy-interop bridge races on nil subview pointers
when a library lacks native Fabric support. `react-native-maps` and its
downstream `react-native-map-clustering` are the offenders — they still
render through the legacy view-manager pipeline under New Arch and hit
the nil-insert path during rapid Marker mount/unmount cycles.

Flipping `newArchEnabled: false` routes every component through the
stable Paper renderer where `react-native-maps` works reliably. Zero
JS changes required.

## When to revisit

Re-enable `newArchEnabled: true` once ALL of the following are met:

1. `react-native-maps` ships an official Fabric-native component
   (tracked upstream at **react-native-maps/react-native-maps#4937**).
   As of 2026-05, this is in active development but has NOT landed
   in a published release.
2. `react-native-map-clustering` either adopts Fabric support OR we
   migrate off it to a native cluster impl built into the Fabric fork.
3. All other native modules we use have Fabric parity:
   - `react-native-svg` ✅ (has Fabric support as of 15.x)
   - `expo-*` modules ✅ (all Fabric-ready)
   - `@react-native-community/*` — audit required
   - `react-native-reanimated` ✅ (has Fabric support)
   - `react-native-gesture-handler` ✅
   - `@shopify/flash-list` ✅

## How to validate the re-enable

When you flip `newArchEnabled: true` again:

1. Build a TestFlight on a **real low-end Android device** (Pixel 4a or
   older) — Android is where New Arch perf wins matter most AND where
   legacy-interop regressions most commonly surface.
2. Pinch-zoom-out on the Explore map 20+ times in succession. The
   previous crash was 100% reproducible — if it doesn't reproduce
   within 30s, the Fabric interop path is clean.
3. Leave the `_NilSafePin` / `_NilSafeCluster` wrappers in place
   (in `PremiumMapPin.tsx`). They cost nothing and mean we never
   have to re-diagnose this crash class.
4. Watch Xcode Console.app for `[CRASH]` logs during a 5-minute
   exploration session.

## Related files

- `/app/frontend/app.json` — the flag itself
- `/app/frontend/src/components/PremiumMapPin.tsx` — nil-safe wrappers
- `/app/frontend/src/components/SafeClusteredMapView.tsx` — NaN/range
  region clamping (unchanged, still useful under Paper)
- `/app/frontend/app/(tabs)/explore.tsx` — memoized `renderedMarkers`
  array (works under both renderers)
