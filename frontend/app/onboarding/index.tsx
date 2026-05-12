import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Dimensions,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
// SafeAreaView from `react-native-safe-area-context` (NOT react-native)
// because the legacy RN SafeAreaView does not respect Android's system
// gesture / 3-button navigation bar inset under edge-to-edge mode —
// causing the bottom "I already have an account" link to be clipped.
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera, Map, Lock, Compass, Check } from 'lucide-react-native';
import { colors, font, space, radii, SHOOT_TYPES } from '../../src/theme';
import { Button } from '../../src/components/Button';

const { width: W } = Dimensions.get('window');

const slides = [
  {
    // Phase 1 onboarding v2 (Jun 2025) — opener refreshed to lead with
    // the two-part promise (better spots + meeting photographers).
    title: 'Find better\nphoto spots.',
    body: 'LumaScout helps you scout locations, save ideas, and connect with local photographers.',
    image: 'https://images.unsplash.com/photo-1672285312540-f1786a51a097?w=1200&q=85',
    icon: <Camera size={28} color={colors.primary} />,
  },
  {
    title: 'Save every\nlocation.',
    body: 'Capture exact coordinates, light notes, parking, permits, and your own shoot intelligence for next time.',
    image: 'https://images.unsplash.com/photo-1632452888109-af6d83269329?w=1200&q=85',
    icon: <Map size={28} color={colors.primary} />,
  },
  {
    title: 'Public spots.\nPrivate spots.',
    body: 'Keep your secret meadow private. Share community gems publicly. You decide what stays yours.',
    image: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&q=85',
    icon: <Lock size={28} color={colors.primary} />,
  },
  {
    title: 'Plan smarter\nwith Scout AI.',
    body: 'Your official LumaScout assistant. Weekend itineraries, driving routes, theme-matched collections — built from real spots.',
    image: 'https://images.unsplash.com/photo-1682458856875-7bc127399b77?w=1200&q=85',
    icon: <Compass size={28} color={colors.primary} />,
  },
];

export default function Onboarding() {
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  // ANDROID FIX (June 2025 v2 — touch-target above gesture zone):
  // Even with SafeAreaView, Android's gesture-exclusion area extends
  // ~24-32dp ABOVE the visible system nav bar — so the tappable area
  // of "I already have an account" was being silently consumed by the
  // OS even though the visual hit-box looked right. Adding an extra
  // 24dp on Android (on top of the SafeAreaView inset) lifts the
  // touch target clear of the gesture zone.
  const insets = useSafeAreaInsets();
  const extraBottomPad = Platform.OS === 'android' ? 24 : 0;
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [showSpecialties, setShowSpecialties] = useState(false);

  const next = () => {
    if (index < slides.length - 1) {
      scrollRef.current?.scrollTo({ x: (index + 1) * W, animated: true });
      setIndex(index + 1);
    } else {
      setShowSpecialties(true);
    }
  };

  const onMomentumScroll = (e: any) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / W);
    setIndex(i);
  };

  const toggleSpecialty = (s: string) => {
    setSelectedSpecialties((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  if (showSpecialties) {
    return (
      <SafeAreaView style={styles.root} testID="onboarding-specialties">
        <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.xxxl }}>
          <Text style={styles.specHead}>What do you shoot?</Text>
          <Text style={styles.specSub}>
            Pick a few specialties so we can tailor your home feed. You can change these any time.
          </Text>
          <View style={styles.specGrid}>
            {SHOOT_TYPES.map((s) => {
              const active = selectedSpecialties.includes(s);
              return (
                <TouchableOpacity
                  key={s}
                  testID={`specialty-${s}`}
                  onPress={() => toggleSpecialty(s)}
                  style={[styles.specPill, active && styles.specPillActive]}
                  activeOpacity={0.85}
                >
                  {active && <Check size={14} color={colors.textInverse} style={{ marginRight: 6 }} />}
                  <Text style={[styles.specPillText, active && { color: colors.textInverse }]}>{s}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={{ paddingHorizontal: space.xl, paddingBottom: space.xxl, gap: space.md }}>
          <Button
            title="Create account"
            testID="onboarding-create-account"
            onPress={() => router.push({ pathname: '/(auth)/register', params: { specs: selectedSpecialties.join(',') } })}
          />
          <Button
            title="I already have an account"
            variant="ghost"
            testID="onboarding-have-account"
            onPress={() => router.push('/(auth)/login')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScroll}
        testID="onboarding-scroll"
      >
        {slides.map((s, i) => (
          <View key={i} style={{ width: W, flex: 1 }}>
            <Image source={{ uri: s.image }} style={styles.heroImg} resizeMode="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(10,10,10,0.6)', colors.bg]}
              style={styles.gradient}
              locations={[0.2, 0.55, 0.95]}
            />
            <SafeAreaView
              style={[
                styles.textLayer,
                // ANDROID FIX (June 2025 v3 — gesture-exclusion zone):
                // With edgeToEdgeEnabled=true, useSafeAreaInsets().bottom
                // can return 0 on Android because the gesture/3-button
                // nav bar is "transparent" to RN's safe-area system —
                // so SafeAreaView's edges={['bottom']} provides ZERO
                // clearance. We hard-floor the bottom padding at 80dp
                // on Android, which is well above the ~32dp gesture
                // exclusion area on every modern device, guaranteeing
                // the "I already have an account" link is above the
                // OS touch-priority zone. iOS keeps space.xxl (32pt).
                Platform.OS === 'android' ? { paddingBottom: 80 } : null,
              ]}
              edges={['bottom']}
              pointerEvents="box-none"
            >
              <View style={{ flex: 1 }} />
              <View style={styles.slideIcon}>{s.icon}</View>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>
              <View style={styles.dots}>
                {slides.map((_, j) => (
                  <View
                    key={j}
                    style={[styles.dot, j === index && styles.dotActive]}
                  />
                ))}
              </View>
              <Button
                title={i === slides.length - 1 ? 'Get started' : 'Next'}
                onPress={next}
                testID={`onboarding-next-${i}`}
                style={{ marginBottom: space.md }}
              />
              <TouchableOpacity
                onPress={() => router.push('/(auth)/login')}
                // Larger hitSlop so the touch target extends 12dp in
                // every direction beyond the visible text — bullet-
                // proofing tap reliability on dense Android nav bars.
                hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
                style={{ paddingVertical: 8 }}
              >
                <Text style={styles.skip}>I already have an account</Text>
              </TouchableOpacity>
            </SafeAreaView>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  heroImg: { width: W, height: '65%', position: 'absolute', top: 0, left: 0 },
  gradient: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  textLayer: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
  },
  slideIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -0.8,
    marginBottom: space.md,
  },
  body: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: space.xxl,
  },
  dots: { flexDirection: 'row', gap: 6, marginBottom: space.xxl },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface3,
  },
  dotActive: { width: 22, backgroundColor: colors.primary },
  skip: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 14,
  },
  specHead: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 36,
    letterSpacing: -0.5,
    marginTop: space.md,
  },
  specSub: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 15,
    marginTop: space.sm,
    marginBottom: space.xl,
    lineHeight: 22,
  },
  specGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  specPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  specPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  specPillText: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 14,
  },
});
