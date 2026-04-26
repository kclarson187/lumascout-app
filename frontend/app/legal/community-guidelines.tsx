/**
 * Community Guidelines — public values for LumaScout creators.
 * Premium dark luxury layout via SettingsScreen primitive.
 */
import React from 'react';
import { Text, StyleSheet, Linking, Pressable } from 'react-native';
import { SettingsScreen, Section, Para } from '../../src/components/SettingsLayout';
import { colors, font } from '../../src/theme';

export default function CommunityGuidelines() {
  return (
    <SettingsScreen title="Community Guidelines" subtitle="Effective April 2026">
      <Section label="OUR PROMISE">
        <Para>
          LumaScout is a community of photographers — pros, hobbyists, and travelers — sharing the places that move them. These guidelines exist so every creator feels safe, respected, and credited for their work.
        </Para>
      </Section>

      <Section label="RESPECT OTHERS">
        <Para>Treat every member with the same respect you'd want at a real shoot. Disagreements are fine; cruelty is not.</Para>
        <Para>Do not personally attack, demean, or stalk any user based on race, gender, identity, age, ability, religion, or anything else.</Para>
      </Section>

      <Section label="NO HARASSMENT">
        <Para>Repeated unwanted contact, threats, doxxing, or coordinated pile-ons will result in immediate account removal.</Para>
        <Para>If you feel harassed, use the report button on the offending message, comment, or profile. We review every report within 48 hours.</Para>
      </Section>

      <Section label="NO STOLEN PHOTOS">
        <Para>Only upload images you took yourself or have explicit permission to publish. Any verified copyright complaint will result in the photo's removal and a strike on your account.</Para>
        <Para>We honor DMCA takedowns. Email <Text style={s.bold}>copyright@lumascout.app</Text>.</Para>
      </Section>

      <Section label="NO SPAM">
        <Para>Don't flood feeds, comments, or DMs with promotional links, irrelevant content, or duplicate posts.</Para>
        <Para>Affiliate links must be clearly marked. Generic "DM me to promote" pitches will be removed.</Para>
      </Section>

      <Section label="HONEST LOCATION INFO">
        <Para>Submit accurate coordinates, real access notes, and truthful weather/season descriptions. Misleading uploads waste other photographers' trips and hurt the community.</Para>
        <Para>If you discover a spot has changed (closed access, new fees, hazards), tap "Suggest Edit" so we can keep the listing accurate.</Para>
      </Section>

      <Section label="PROTECT PRIVATE LAND">
        <Para>Never publish a location that requires trespassing. Always note when a spot sits on private property and what permission is required (verbal, written, paid permit).</Para>
        <Para>Respect closures. If a landowner asks for a spot to be removed, we will remove it within 24 hours.</Para>
      </Section>

      <Section label="NO ILLEGAL ACTIVITY">
        <Para>Do not promote drone use in restricted airspace, ignore park closures, encourage trespassing, or coordinate any unlawful activity through LumaScout.</Para>
        <Para>Content depicting minors in unsafe situations, weapons threats, or any sexual exploitation will be removed and reported to the appropriate authorities.</Para>
      </Section>

      <Section label="ENFORCEMENT">
        <Para>Most issues end in a friendly nudge. Repeat or severe violations result in temporary suspension or permanent removal at our discretion.</Para>
        <Para>Appeals are reviewed by a human within 7 days. Email <Text style={s.bold}>support@lumascout.app</Text>.</Para>
      </Section>

      <Section label="REPORT A PROBLEM">
        <Para>
          See something that breaks these rules? Tap the report button anywhere or email{' '}
          <Pressable onPress={() => Linking.openURL('mailto:support@lumascout.app')}>
            <Text style={s.link}>support@lumascout.app</Text>
          </Pressable>
          . We're a small team and we read every message.
        </Para>
      </Section>
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  bold: { color: colors.text, fontFamily: font.bodyBold },
  link: { color: colors.primary, fontFamily: font.bodySemibold },
});
