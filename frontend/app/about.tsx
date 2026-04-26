/**
 * About LumaScout — founder-quality intro page.
 */
import React from 'react';
import { View, Text, StyleSheet, Linking, Pressable, Image } from 'react-native';
import Constants from 'expo-constants';
import { Sparkles } from 'lucide-react-native';
import { SettingsScreen, Section, Para } from '../src/components/SettingsLayout';
import { colors, font, space } from '../src/theme';

export default function About() {
  const v = (Constants.expoConfig as any)?.version || '1.0.0';
  const build = (Constants.expoConfig as any)?.ios?.buildNumber
    || (Constants.expoConfig as any)?.android?.versionCode
    || '—';

  return (
    <SettingsScreen title="About LumaScout" subtitle="The photographer's planning tool">
      <View style={s.heroCard}>
        <View style={s.heroIcon}>
          <Sparkles size={22} color={colors.primary} />
        </View>
        <Text style={s.heroKicker}>OUR MISSION</Text>
        <Text style={s.heroLine}>
          Become the go-to tool photographers open before every shoot.
        </Text>
      </View>

      <Section label="WHAT LUMASCOUT DOES">
        <Para>
          • Discover great photo locations near you and around the world{'\n'}
          • Plan shoots with light, weather, and access details in one place{'\n'}
          • Grow your photographer network and find collaborators{'\n'}
          • Get opportunities — referrals, second-shooter calls, branded work{'\n'}
          • Sell your own digital products — presets, guides, routes, spot packs
        </Para>
      </Section>

      <Section label="BUILT FOR PROS">
        <Para>
          We built LumaScout because we kept losing time hunting for fresh
          locations, vetting them on Reddit, sharing scout texts in group
          chats, and trying to find the right second-shooter for a tight
          deadline. So we built one place for all of it — with a premium,
          quiet, distraction-free interface that respects your time.
        </Para>
      </Section>

      <Section label="VERSION">
        <Para>
          LumaScout v{v} · build {String(build)}
        </Para>
      </Section>

      <Section label="CONTACT">
        <Para>
          Reach the team:{' '}
          <Pressable onPress={() => Linking.openURL('mailto:support@lumascout.app')}>
            <Text style={s.link}>support@lumascout.app</Text>
          </Pressable>
        </Para>
      </Section>
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  heroCard: {
    padding: 18, borderRadius: 22, marginBottom: 22,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
    alignItems: 'flex-start', gap: 6,
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  heroKicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 1.0 },
  heroLine: { color: colors.text, fontFamily: font.display, fontSize: 19, letterSpacing: -0.3, lineHeight: 25 },
  link: { color: colors.primary, fontFamily: font.bodySemibold },
});
