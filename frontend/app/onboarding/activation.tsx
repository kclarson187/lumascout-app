/**
 * /onboarding/activation — Phase 2.1 (Jun 2025).
 *
 * Final celebratory step in the new-user wizard. Three
 * suggestion cards deep-link into the corresponding app surface;
 * they are intentionally NOT real progress trackers this round
 * (per user direction — progress tracking lands in 2.2).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users, MapPin, Search, ChevronRight, Sparkles } from 'lucide-react-native';
import { colors, font, space, radii } from '../../src/theme';

type Card = {
  key: string;
  icon: any;
  title: string;
  body: string;
  cta: string;
  route: string;
  tint: string;
  testID: string;
};

const CARDS: Card[] = [
  {
    key:    'follow',
    icon:   Users,
    title:  'Follow 3 nearby photographers',
    body:   'Build your community with people shooting nearby.',
    cta:    'Open Network',
    route:  '/(tabs)/network',
    tint:   '#60A5FA',
    testID: 'activation-follow' },
  {
    key:    'save',
    icon:   MapPin,
    title:  'Save 1 spot you love',
    body:   'Keep ideas for your next session in one place.',
    cta:    'Open Explore',
    route:  '/(tabs)/explore',
    tint:   colors.success,
    testID: 'activation-save' },
  {
    key:    'search',
    icon:   Search,
    title:  'Run 1 local search',
    body:   'See what photographers near you have already mapped.',
    cta:    'Search now',
    route:  '/(tabs)/explore',
    tint:   colors.primary,
    testID: 'activation-search' },
];

export default function OnboardingActivation() {
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.progressRow}>
          <View style={[styles.progressDot, styles.progressDotDone]} />
          <View style={[styles.progressDot, styles.progressDotDone]} />
          <View style={[styles.progressDot, styles.progressDotDone]} />
          <View style={[styles.progressDot, styles.progressDotActive]} />
        </View>

        <View style={styles.glyphRing}>
          <Sparkles size={24} color={colors.primary} />
        </View>

        <Text style={styles.head}>You’re all set.</Text>
        <Text style={styles.sub}>
          Here are three quick ways to start exploring LumaScout.
        </Text>

        <View style={{ gap: 10, marginTop: space.xl }}>
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => router.replace(c.route as any)}
                style={styles.card}
                testID={c.testID}
                activeOpacity={0.8}
              >
                <View style={[styles.cardIcon, { backgroundColor: c.tint + '1f' }]}>
                  <Icon size={18} color={c.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.cardBody} numberOfLines={2}>{c.body}</Text>
                  <Text style={styles.cardCta}>{c.cta} ›</Text>
                </View>
                <ChevronRight size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ marginTop: space.xxxl }}>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)' as any)}
            style={styles.primaryBtn}
            testID="activation-done"
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnTxt}>Start exploring</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { padding: space.xl, paddingBottom: space.xxxl, gap: 4 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.lg },
  progressDot: { width: 18, height: 3, borderRadius: 2, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.primary, width: 22 },
  progressDotDone: { backgroundColor: 'rgba(245,166,35,0.55)' },

  glyphRing: {
    alignSelf: 'center',
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.30)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: space.md, marginBottom: space.md },
  head: { color: colors.text, fontFamily: font.display, fontSize: 28, textAlign: 'center', letterSpacing: -0.4 },
  sub: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 14,
    textAlign: 'center', lineHeight: 20, marginTop: 6 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: space.md, paddingVertical: space.md,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cardIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  cardBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
  cardCta: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, marginTop: 6 },

  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: radii.md,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  primaryBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 15 } });
