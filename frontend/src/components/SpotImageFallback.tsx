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
const GRADIENTS: [string, string, string][] = [
  ['#3a1d0e', '#7a3a0f', '#F5A623'], // Amber sunset
  ['#0b1e33', '#1e3a5f', '#3b82f6'], // Deep ocean
  ['#0f1f16', '#164332', '#10B981'], // Forest
  ['#2a0f1f', '#5e1a3e', '#D04848'], // Rose
  ['#1a0e2a', '#3b2157', '#8b5cf6'], // Purple dusk
  ['#0b1624', '#163045', '#60A5FA'], // Ice blue
  ['#241308', '#4a250f', '#FBBF24'], // Warm ember
  ['#14141a', '#26262E', '#71717A'], // Charcoal neutral
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
