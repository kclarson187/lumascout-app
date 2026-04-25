/**
 * Premium dark map style — matte charcoal base, deep blue water,
 * de-emphasised label noise. Inspired by the Apple Maps dark mode and
 * Airbnb's nightline theme. Used by the Explore tab MapView via the
 * `customMapStyle` prop on iOS/Android.
 */
const MAP_STYLE_DARK: any[] = [
  // Base canvas — deep matte black
  { elementType: 'geometry', stylers: [{ color: '#0c0c10' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7a7a82' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0c0c10' }] },

  // Hide low-value POI labels by default — keeps the map cinematic.
  {
    featureType: 'poi',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#13201a' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3d6f4d' }],
  },

  // Roads — clean charcoal hierarchy
  {
    featureType: 'road',
    elementType: 'geometry.fill',
    stylers: [{ color: '#1c1c22' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#0c0c10' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#5a5a64' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'geometry.fill',
    stylers: [{ color: '#23232a' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.fill',
    stylers: [{ color: '#2c2c34' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#0c0c10' }],
  },
  {
    featureType: 'road.local',
    elementType: 'geometry.fill',
    stylers: [{ color: '#1a1a20' }],
  },

  // Hide subway / transit clutter
  {
    featureType: 'transit',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#1f1f26' }],
  },

  // Terrain — subtle desaturated tones
  {
    featureType: 'landscape',
    elementType: 'geometry',
    stylers: [{ color: '#13131a' }],
  },
  {
    featureType: 'landscape.man_made',
    elementType: 'geometry',
    stylers: [{ color: '#15151c' }],
  },
  {
    featureType: 'landscape.natural',
    elementType: 'geometry',
    stylers: [{ color: '#161620' }],
  },

  // Water — rich navy blue (Apple-like)
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0d1726' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#3a5a8a' }],
  },

  // Administrative — only the country/state lines, no city dots until zoom-in
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#9aa0aa' }],
  },
  {
    featureType: 'administrative.country',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#cfcfd6' }],
  },
  {
    featureType: 'administrative.neighborhood',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'administrative.land_parcel',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
];

export default MAP_STYLE_DARK;
