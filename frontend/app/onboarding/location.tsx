/**
 * /onboarding/location — Phase 2.1 (Jun 2025).
 *
 * Pre-permission primer for foreground location. The OS-level prompt
 * is the one that actually grants access — this screen explains WHY,
 * because users who see the OS prompt first tend to deny it.
 *
 * Flow:
 *   • Enable location  → request foreground permission via expo-location
 *                       → /onboarding/photographer (regardless of grant)
 *   • Not now          → /onboarding/photographer
 *
 * We never block on denial — user can enable later in Settings. The
 * decision is recorded only by the OS; we don't persist anything
 * server-side here. Precise location is deferred to the add-spot /
 * exact-map flows (per PRD).
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MapPin, Navigation, Check } from 'lucide-react-native';
import * as Location from 'expo-location';
import { colors, font, space, radii } from '../../src/theme';

export default function OnboardingLocation() {
  const [working, setWorking] = useState(false);
  const [denied,  setDenied]  = useState(false);

  const goNext = () => router.replace('/onboarding/photographer' as any);

  const onEnable = async () => {
    if (working) return;
    setWorking(true);
    setDenied(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') setDenied(true);
    } catch {
      // expo-location can throw on web/some sims — treat as soft denial.
      setDenied(true);
    } finally {
      setWorking(false);
      // Always advance — the screen is informational, not blocking.
      setTimeout(goNext, denied ? 1100 : 350);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.progressRow}>
          <View style={[styles.progressDot, styles.progressDotDone]} />
          <View style={[styles.progressDot, styles.progressDotDone]} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
        </View>

        <View style={styles.iconWrap}>
          <View style={styles.iconRing}>
            <MapPin size={36} color={colors.primary} />
          </View>
        </View>

        <Text style={styles.head}>See spots and photographers near you</Text>
        <Text style={styles.sub}>
          We use your location for nearby spots, drive times, and local
          recommendations. Your public profile only shows city/region.
        </Text>

        <View style={styles.bulletList}>
          <Bullet text="Approximate location for discovery — not your address." />
          <Bullet text="Precise location is only used when you add a spot." />
          <Bullet text="You can turn this off any time in Settings." />
        </View>

        {denied ? (
          <View style={styles.deniedBox} testID="location-denied-note">
            <Text style={styles.deniedTxt}>
              No problem. You can turn this on later in Settings.
            </Text>
          </View>
        ) : null}

        <View style={{ gap: 10, marginTop: space.xl }}>
          <TouchableOpacity
            onPress={onEnable}
            disabled={working}
            style={[styles.primaryBtn, working && { opacity: 0.7 }]}
            testID="location-enable"
            activeOpacity={0.85}
          >
            {working ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <>
                <Navigation size={14} color={colors.textInverse} />
                <Text style={styles.primaryBtnTxt}>Enable location</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goNext}
            disabled={working}
            style={styles.skipBtn}
            testID="location-skip"
            activeOpacity={0.7}
          >
            <Text style={styles.skipTxt}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.bulletDot}>
        <Check size={10} color={colors.primary} />
      </View>
      <Text style={styles.bulletTxt}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { flex: 1, padding: space.xl, gap: 0 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.lg },
  progressDot: { width: 18, height: 3, borderRadius: 2, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.primary, width: 22 },
  progressDotDone: { backgroundColor: 'rgba(245,166,35,0.55)' },

  iconWrap: { alignItems: 'center', marginVertical: space.xxl },
  iconRing: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.30)',
    alignItems: 'center', justifyContent: 'center',
  },

  head: {
    color: colors.text, fontFamily: font.display, fontSize: 26,
    textAlign: 'center', letterSpacing: -0.3, lineHeight: 32,
  },
  sub: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 14,
    textAlign: 'center', lineHeight: 21, marginTop: 10,
    paddingHorizontal: space.md,
  },

  bulletList: { marginTop: space.xxl, gap: 10 },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  bulletTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, flex: 1, lineHeight: 18 },

  deniedBox: {
    marginTop: space.xl,
    padding: space.md,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  deniedTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radii.md,
    paddingVertical: 14, minHeight: 48,
  },
  primaryBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 15 },
  skipBtn: { paddingVertical: 12, alignItems: 'center' },
  skipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
});
