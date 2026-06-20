// Native entry point — re-exports react-native-maps for iOS/Android. Metro
// automatically picks this file on non-web platforms. See maps-module.web.ts
// for the web stub that prevents native-only deps from poisoning the web bundle.
//
// STABILITY (Nov 2026): clustering has been removed from LumaScout. The
// `ClusteredMapView` export below is now an ALIAS for `MapView` and the
// `react-native-map-clustering` dependency is no longer imported. The alias
// is retained so any straggling import sites compile, but the runtime
// behavior is plain map rendering with NO clustering whatsoever.
//
// CRASH HARDENING (Jun 2026): top-level `require('react-native-maps')` was
// the suspected trigger for the v2.0.78-2.0.80 standalone iOS launch crash
// (Expo Go was unaffected because Expo Go uses its own native shell). If
// the native module fails to initialize at module-load time, the require()
// call would throw synchronously and kill the app before any JS executes.
// We now wrap the require in try/catch and export safe nulls so the import
// can never crash the app. Components that render maps must already guard
// against null exports (SafeMapView does this).
let maps: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  maps = require('react-native-maps');
} catch (e) {
  // Native module not linked or failed to initialize. Components that
  // depend on these exports must render a fallback when MapView is null.
  // eslint-disable-next-line no-console
  console.warn('[maps-module] react-native-maps failed to load (non-fatal):', e);
}
export const MapView: any = maps?.default ?? null;
// Alias only — see comment above. Do NOT replace this with a clustering
// implementation without explicit product approval.
export const ClusteredMapView: any = maps?.default ?? null;
export const Marker: any = maps?.Marker ?? null;
// Google Maps provider — required on Android (default provider is the
// legacy native module that's incompatible with Fabric / New Architecture).
// On iOS this is unused (we let react-native-maps default to Apple Maps).
export const PROVIDER_GOOGLE: any = maps?.PROVIDER_GOOGLE ?? null;
export const PROVIDER_DEFAULT: any = maps?.PROVIDER_DEFAULT ?? null;
