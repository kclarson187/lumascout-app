export const colors = {
  bg: '#0A0A0A',
  surface1: '#141416',
  surface2: '#1E1E21',
  surface3: '#26262B',
  overlay: 'rgba(10,10,10,0.6)',
  border: '#2A2A2E',
  borderSubtle: '#1E1E21',
  primary: '#F5A623',
  primaryDark: '#D48B1B',
  secondary: '#D04848',
  success: '#10B981',
  warning: '#FBBF24',
  info: '#60A5FA',
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#71717A',
  textInverse: '#000000',
  pinPublic: '#FFFFFF',
  pinPremium: '#F5A623',
  pinSaved: '#60A5FA',
  pinVerified: '#10B981',
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
};

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
};

export const font = {
  display: 'PlayfairDisplay_700Bold',
  displayItalic: 'PlayfairDisplay_600SemiBold_Italic',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemibold: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
};

export const SHOOT_TYPES = [
  'Family', 'Pet', 'Wedding', 'Portrait', 'Seniors', 'Branding', 'Nature', 'Urban',
];

export const QUICK_FILTERS = [
  'Family', 'Pet', 'Wedding', 'Urban', 'Nature', 'Sunset', 'Indoor', 'Dog Friendly',
];

export const BEST_TIMES = [
  { key: 'sunrise', label: 'Sunrise' },
  { key: 'morning', label: 'Morning' },
  { key: 'golden_hour', label: 'Golden Hour' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'sunset', label: 'Sunset' },
  { key: 'evening', label: 'Evening' },
];

export const PRIVACY_MODES = [
  { key: 'public', label: 'Public', help: 'Visible on the map to everyone. Goes through quick review.' },
  { key: 'followers', label: 'Followers', help: 'Only people who follow you can see this spot.' },
  { key: 'private', label: 'Private', help: 'Just for you. Never shared.' },
  { key: 'premium', label: 'Premium', help: 'Requires subscription to view. (Coming soon)' },
];
