// Native entry point — re-exports react-native-maps for iOS/Android. Metro
// automatically picks this file on non-web platforms. See maps-module.web.ts
// for the web stub that prevents native-only deps from poisoning the web bundle.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const maps = require('react-native-maps');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const clustering = require('react-native-map-clustering');
export const MapView: any = maps.default;
export const ClusteredMapView: any = clustering.default;
export const Marker: any = maps.Marker;
// Google Maps provider — required on Android (default provider is the
// legacy native module that's incompatible with Fabric / New Architecture).
// On iOS this is unused (we let react-native-maps default to Apple Maps).
export const PROVIDER_GOOGLE: any = maps.PROVIDER_GOOGLE;
export const PROVIDER_DEFAULT: any = maps.PROVIDER_DEFAULT;
