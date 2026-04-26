/**
 * Privacy Policy — in-app legal page (App Store trust requirement).
 */
import React from 'react';
import { Text, StyleSheet, Linking, Pressable } from 'react-native';
import { SettingsScreen, Section, Para } from '../../src/components/SettingsLayout';
import { colors, font } from '../../src/theme';

export default function PrivacyPolicy() {
  return (
    <SettingsScreen title="Privacy Policy" subtitle="Last updated April 2026">
      <Section label="OVERVIEW">
        <Para>
          LumaScout ("we", "us") helps photographers discover photo locations,
          plan shoots, build a network, and sell digital products. This page
          explains what we collect, why, and how we keep it safe.
        </Para>
      </Section>

      <Section label="WHAT WE COLLECT">
        <Para><Text style={s.bold}>Profile data</Text>{'\n'}Name, username, email, photo, bio, specialties, social links you choose to add.</Para>
        <Para><Text style={s.bold}>Uploaded photos</Text>{'\n'}Images you add to spots, packs, posts, and your profile. We store the image plus optional metadata you provide (camera, lens, settings).</Para>
        <Para><Text style={s.bold}>Location</Text>{'\n'}With your permission, we use precise GPS to compute distance to nearby spots. If you deny access, we use your default city instead. We never share your live location with other users.</Para>
        <Para><Text style={s.bold}>Analytics</Text>{'\n'}Aggregate, non-identifying usage signals (which screens are visited, which features are used) to improve the app. Never used to fingerprint or sell.</Para>
        <Para><Text style={s.bold}>Payments</Text>{'\n'}Subscription and marketplace transactions are handled by Stripe. We store the order summary and your subscription tier. We never see your full card number.</Para>
        <Para><Text style={s.bold}>Messaging</Text>{'\n'}Direct messages between users are stored securely so you can read history across devices. Admins access them only when investigating reported abuse.</Para>
      </Section>

      <Section label="YOUR CONTROLS">
        <Para>You can edit your profile, change your privacy settings, hide your exact location, mute notifications, and delete your account from Settings at any time.</Para>
        <Para>Spot privacy: you can mark spots as Public, Followers only, or Premium when uploading.</Para>
      </Section>

      <Section label="HOW WE PROTECT DATA">
        <Para>
          All traffic is encrypted in transit (HTTPS/TLS). Passwords are hashed with bcrypt. Database access is restricted and audited. We never sell or rent your data to third parties.
        </Para>
      </Section>

      <Section label="CONTACT">
        <Para>
          Questions, requests, or data exports? Email{' '}
          <Pressable onPress={() => Linking.openURL('mailto:support@lumascout.app')}>
            <Text style={s.link}>support@lumascout.app</Text>
          </Pressable>
          {'.'}
        </Para>
      </Section>
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  bold: { color: colors.text, fontFamily: font.bodyBold },
  link: { color: colors.primary, fontFamily: font.bodySemibold },
});
