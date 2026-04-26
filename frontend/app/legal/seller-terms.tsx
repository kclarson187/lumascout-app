/**
 * Marketplace Seller Terms — for creators publishing packs on LumaScout.
 */
import React from 'react';
import { Text, StyleSheet, Linking, Pressable } from 'react-native';
import { SettingsScreen, Section, Para } from '../../src/components/SettingsLayout';
import { colors, font } from '../../src/theme';

export default function SellerTerms() {
  return (
    <SettingsScreen title="Marketplace Seller Terms" subtitle="Effective April 2026">
      <Section label="OVERVIEW">
        <Para>
          The LumaScout Marketplace lets creators publish and sell digital goods — photo packs, LUTs, presets, location guides, and more — directly to other photographers. By listing a product, you agree to the terms below.
        </Para>
      </Section>

      <Section label="SELLER RESPONSIBILITIES">
        <Para>You confirm that you own the rights to every asset you publish or have explicit permission from the rightsholder.</Para>
        <Para>Your listing must accurately describe what's included: number of photos/LUTs, file formats, intended use cases, and any limitations.</Para>
        <Para>You provide reasonable customer support: respond to buyer messages within 5 business days and address legitimate file-delivery issues.</Para>
        <Para>You may not impersonate another creator, copy listings, or use another seller's preview imagery.</Para>
      </Section>

      <Section label="FEES">
        <Para>LumaScout charges a flat <Text style={s.bold}>15%</Text> platform fee on every successful sale. Stripe processing (~2.9% + $0.30) is deducted separately.</Para>
        <Para>Net to seller per $20 sale ≈ <Text style={s.bold}>$15.91</Text> after platform + Stripe fees.</Para>
        <Para>Elite-tier subscribers receive a reduced <Text style={s.bold}>10%</Text> platform fee as a perk of membership.</Para>
      </Section>

      <Section label="PAYOUT TIMING">
        <Para>Payouts are issued via Stripe Connect to your linked bank or debit card.</Para>
        <Para>Standard schedule: <Text style={s.bold}>weekly on Mondays</Text>. The first payout for a new seller is held for 7 business days while we verify identity.</Para>
        <Para>Rolling reserve: 5% of monthly gross is held for 30 days to cover potential refunds or chargebacks. This balance is paid out as it ages.</Para>
      </Section>

      <Section label="PROHIBITED ITEMS">
        <Para>You may not sell:</Para>
        <Para>• Stock photos you don't own or have not licensed for resale.</Para>
        <Para>• AI-generated content presented as original photography without disclosure.</Para>
        <Para>• Photos that include identifiable people without their model release.</Para>
        <Para>• Locations on private land where you don't have publication permission.</Para>
        <Para>• Anything that violates copyright, trademark, or privacy law.</Para>
        <Para>• Adult, explicit, or violent content.</Para>
      </Section>

      <Section label="REFUND DISPUTES">
        <Para>If a buyer reports a materially defective product within 14 days, you have 48 hours to respond before LumaScout staff mediates.</Para>
        <Para>Verified defects (wrong files, broken downloads, incorrect description) result in a full refund to the buyer; the platform fee is also reversed.</Para>
        <Para>Repeated, unresolved disputes may result in your seller account being paused or removed.</Para>
      </Section>

      <Section label="TAXES">
        <Para>You are solely responsible for reporting and paying any sales tax, VAT, or income tax on your earnings.</Para>
        <Para>Stripe Connect issues a <Text style={s.bold}>1099-K</Text> at year-end if your gross U.S. sales exceed the IRS threshold for that tax year. Non-U.S. sellers receive their local-equivalent statement when applicable.</Para>
        <Para>This is not tax advice — please consult a CPA.</Para>
      </Section>

      <Section label="TERMINATION">
        <Para>You may delist any product at any time from your seller dashboard. Existing buyers retain access to their purchased downloads.</Para>
        <Para>LumaScout may remove listings or close seller accounts that violate these terms or our Community Guidelines, with written notice when possible.</Para>
      </Section>

      <Section label="CONTACT">
        <Para>
          Questions? Email{' '}
          <Pressable onPress={() => Linking.openURL('mailto:sellers@lumascout.app')}>
            <Text style={s.link}>sellers@lumascout.app</Text>
          </Pressable>
          .
        </Para>
      </Section>
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  bold: { color: colors.text, fontFamily: font.bodyBold },
  link: { color: colors.primary, fontFamily: font.bodySemibold },
});
