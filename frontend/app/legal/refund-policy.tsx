/**
 * Refund Policy — subscription + marketplace handling.
 * App Store reviewer-friendly: clear, accurate, no "contact us" black-holes.
 */
import React from 'react';
import { Text, StyleSheet, Linking, Pressable } from 'react-native';
import { SettingsScreen, Section, Para } from '../../src/components/SettingsLayout';
import { colors, font } from '../../src/theme';

export default function RefundPolicy() {
  return (
    <SettingsScreen title="Refund Policy" subtitle="Effective April 2026">
      <Section label="OVERVIEW">
        <Para>
          LumaScout offers two paid surfaces: <Text style={s.bold}>subscription plans</Text> (Pro, Elite) and the <Text style={s.bold}>Pack Marketplace</Text> for digital goods. The terms below explain when refunds apply and how to request one.
        </Para>
      </Section>

      <Section label="SUBSCRIPTION BILLING">
        <Para>Subscriptions auto-renew on the same calendar day each month or year, depending on the plan you selected.</Para>
        <Para>You can cancel any time in <Text style={s.bold}>Settings → Account → Subscription</Text>. Cancellation takes effect at the end of the current billing period — you keep paid access until then.</Para>
        <Para>We do not pro-rate partial months. The unused remainder of your current period is yours to use.</Para>
      </Section>

      <Section label="WHEN WE REFUND SUBSCRIPTIONS">
        <Para><Text style={s.bold}>Within 7 days</Text> of a brand-new paid subscription if you've barely used the app, we'll refund 100% on request.</Para>
        <Para><Text style={s.bold}>Duplicate charges</Text> caused by a payment processor glitch are refunded automatically once we detect them, usually within 3 business days.</Para>
        <Para><Text style={s.bold}>Service outages</Text> longer than 48 hours that affect paid features earn a pro-rated credit on your next invoice.</Para>
      </Section>

      <Section label="MARKETPLACE DIGITAL GOODS">
        <Para>Photo packs, LUTs, presets, and PDFs are non-refundable once downloaded — they're consumable digital goods.</Para>
        <Para>If a pack is materially different from its description (wrong photos, broken file), the buyer is entitled to a full refund within 14 days. Open the order in your inbox and tap <Text style={s.bold}>"Request Refund"</Text>.</Para>
        <Para>Sellers approve, decline, or escalate refund requests within 48 hours. Disputes that can't be resolved are arbitrated by LumaScout staff in good faith.</Para>
      </Section>

      <Section label="DUPLICATE OR ACCIDENTAL CHARGES">
        <Para>Spot a charge you don't recognize? Email <Text style={s.bold}>billing@lumascout.app</Text> with the date, amount, and order ID. We'll investigate and refund any verified duplicate within 5 business days.</Para>
      </Section>

      <Section label="APP STORE / GOOGLE PLAY">
        <Para>Purchases made through Apple App Store or Google Play are subject to those platforms' refund policies. Use the platform's own refund flow first; we'll mirror any approved refund on our side immediately.</Para>
      </Section>

      <Section label="CONTACT SUPPORT">
        <Para>
          Questions about a charge, dispute, or refund? Email{' '}
          <Pressable onPress={() => Linking.openURL('mailto:billing@lumascout.app')}>
            <Text style={s.link}>billing@lumascout.app</Text>
          </Pressable>
          {' '}with the order ID and a quick description. We respond within one business day.
        </Para>
      </Section>
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  bold: { color: colors.text, fontFamily: font.bodyBold },
  link: { color: colors.primary, fontFamily: font.bodySemibold },
});
