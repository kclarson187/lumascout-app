// Native entry point — re-exports react-native-maps for iOS/Android. Metro
// automatically picks this file on non-web platforms. See maps-module.web.ts
// for the web stub that prevents native-only deps from poisoning the web bundle.
//
// STABILITY (Nov 2026): clustering has been removed from LumaScout. The
// `ClusteredMapView` export below is now an ALIAS for `MapView` and the
// `react-native-map-clustering` dependency is no longer imported. The alias
// is retained so any straggling import sites compile, but the runtime
// behavior is plain map rendering with NO clustering whatsoever.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const maps = require('react-native-maps');
export const MapView: any = maps.default;
// Alias only — see comment above. Do NOT replace this with a clustering
// implementation without explicit product approval.
export const ClusteredMapView: any = maps.default;
export const Marker: any = maps.Marker;
// Google Maps provider — required on Android (default provider is the
// legacy native module that's incompatible with Fabric / New Architecture).
// On iOS this is unused (we let react-native-maps default to Apple Maps).
export const PROVIDER_GOOGLE: any = maps.PROVIDER_GOOGLE;
export const PROVIDER_DEFAULT: any = maps.PROVIDER_DEFAULT;
