/**
 * Terms of Use — in-app legal page.
 */
import React from 'react';
import { Text, StyleSheet, Linking, Pressable } from 'react-native';
import { SettingsScreen, Section, Para } from '../../src/components/SettingsLayout';
import { colors, font } from '../../src/theme';

export default function TermsOfUse() {
  return (
    <SettingsScreen title="Terms of Use" subtitle="Last updated April 2026">
      <Section label="ACCEPTABLE USE">
        <Para>By using LumaScout you agree to act lawfully and respectfully. No spam, scraping, automated abuse, impersonation, or harassment of other photographers.</Para>
      </Section>
      <Section label="LOCATIONS & TRESPASSING">
        <Para><Text style={s.bold}>You are responsible for your own access.</Text>{'\n'}LumaScout shows photo locations submitted by the community. We do not grant any right of entry. Always confirm whether a spot is on public or private land before visiting, request permission where required, follow posted signage, and respect closures.</Para>
        <Para>When uploading a private-land spot you must disclose it as such and only share locations you have permission to access.</Para>
      </Section>
      <Section label="CONTENT OWNERSHIP">
        <Para>You keep ownership of every photo, pack, and post you upload. You grant LumaScout a limited license to display the content within the app and on shared deep-link pages so other users can view it.</Para>
      </Section>
      <Section label="MARKETPLACE">
        <Para>Sellers may offer presets, guides, route plans, and spot packs. Sellers are responsible for the legality and originality of what they upload. Buyers may receive refunds per our Refund Policy.</Para>
      </Section>
      <Section label="SUBSCRIPTIONS">
        <Para>Pro and Elite subscriptions are billed by Stripe on the cadence you select (monthly or annual). You can cancel any time — access continues until the end of the current billing period. See the in-app Refund Policy for details.</Para>
      </Section>
      <Section label="MODERATION">
        <Para>LumaScout admins may remove content, restrict accounts, or take other action when content violates these terms or community guidelines. We log all admin moderation actions for accountability.</Para>
      </Section>
      <Section label="CONTACT">
        <Para>Questions about these terms? Email{' '}
          <Pressable onPress={() => Linking.openURL('mailto:support@lumascout.app')}>
            <Text style={s.link}>support@lumascout.app</Text>
          </Pressable>{'.'}
        </Para>
      </Section>
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  bold: { color: colors.text, fontFamily: font.bodyBold },
  link: { color: colors.primary, fontFamily: font.bodySemibold },
});
