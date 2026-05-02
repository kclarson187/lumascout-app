import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MountainSnow, Camera } from 'lucide-react-native';
import { colors, font, radii } from '../theme';

/**
 * SpotImageFallback
 *
 * Replaces the previous plain dark block that rendered whenever a spot's cover
 * image was missing OR failed to load (broken URL, network error, CORS).
 *
 * Picks a deterministic gradient per-spot (hashed off the spot id / title) so
 * the same spot always gets the same fallback — prevents flicker on re-render
 * and keeps the Home/Explore/Saved grids visually coherent.
 *
 * Shows:
 *   • Soft camera glyph watermark
 *   • Spot title (max 2 lines)
 *   • Primary shoot type pill (if available)
 *
 * Used by:
 *   - SpotCard (full image-first card)
 *   - SpotCardCompact (64px thumbnail variant)
 */

// Curated dark-premium gradient stops. All paired against the app's charcoal
// palette so they feel native to LumaScout's dark theme.
//
// May 2026 (Map preview gradient palette CR): Dropped the "Charcoal neutral"
// stop because it produced near-black thumbnails that read as "broken" on
// device. Brightened the start-stops on the dark-side gradients so each
// fallback now has visible warmth/colour even at the corners. The end-stops
// (the bright accents at the bottom-right) are kept saturated so the
// camera glyph + title always pop.
const GRADIENTS: [string, string, string][] = [
  ['#5a2d18', '#a9521b', '#F5A623'], // Amber sunset (brightened start)
  ['#13355c', '#2e598f', '#3b82f6'], // Deep ocean (brightened start)
  ['#143b29', '#1f614b', '#10B981'], // Forest (brightened start)
  ['#3f1730', '#831f5c', '#D04848'], // Rose (brightened start)
  ['#2a1844', '#5c3382', '#A78BFA'], // Purple dusk (was too dark, brightened)
  ['#13283a', '#234d6c', '#60A5FA'], // Ice blue (brightened start)
  ['#3a1d0c', '#6c3a17', '#FBBF24'], // Warm ember (brightened start)
  ['#3a2718', '#6e4528', '#F59E0B'], // Caramel (replaces charcoal neutral)
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export default function SpotImageFallback({
  title,
  shootType,
  seed,
  compact,
  style,
}: {
  title?: string;
  shootType?: string;
  seed?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const key = (seed || title || 'spot').toString();
  const grad = GRADIENTS[hashStr(key) % GRADIENTS.length];
  const Icon = compact ? Camera : MountainSnow;

  return (
    <View style={[styles.wrap, style]}>
      <LinearGradient
        colors={grad}
        start={{ x: 0.1, y: 0.05 }}
        end={{ x: 0.95, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Soft vignette to keep text legible */}
      <LinearGradient
        colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.55)']}
        start={{ x: 0.5, y: 0.35 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.glyphWrap, compact && { transform: [{ scale: 0.55 }] }]}>
        <Icon
          size={compact ? 22 : 42}
          color="rgba(255,255,255,0.28)"
          strokeWidth={1.4}
        />
      </View>

      {!compact && (
        <View style={styles.textCol}>
          {!!title && (
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
          )}
          {!!shootType && (
            <View style={styles.chip}>
              <Text style={styles.chipTxt} numberOfLines={1}>
                {shootType.toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphWrap: {
    position: 'absolute',
    top: '18%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    gap: 6,
  },
  title: {
    color: '#fff',
    fontFamily: font.bodySemibold,
    fontSize: 15,
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 4,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(10,10,10,0.55)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  chipTxt: {
    color: '#fff',
    fontSize: 9,
    letterSpacing: 0.8,
    fontFamily: font.bodyBold,
  },
});
