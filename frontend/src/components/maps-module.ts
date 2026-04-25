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
