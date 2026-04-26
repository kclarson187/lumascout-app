/**
 * What's New — in-app changelog. Reusable structure: each entry block
 * declares version + dated bullets so future releases just append.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SettingsScreen } from '../src/components/SettingsLayout';
import { colors, font, space } from '../src/theme';

type Release = { version: string; date: string; highlights: string[]; isLatest?: boolean };

const RELEASES: Release[] = [
  {
    version: '1.4.0',
    date: 'April 2026',
    isLatest: true,
    highlights: [
      'Premium Network tab — unified Discover · Directory · Community',
      'Community feed restored, with referrals + feedback + wins',
      'Faster Home loading and a new Marketplace card',
      'Explore map + list mode polished to App Store quality',
      'Email change flow — update your login email with verification',
      'Land access disclosure on every spot (public / private / unsure)',
    ],
  },
  {
    version: '1.3.0',
    date: 'March 2026',
    highlights: [
      'Premium Profile dashboard with creator analytics',
      'Cinematic Explore map with branded pins + clustering',
      '15-second API timeouts — the app feels snappier on flaky networks',
    ],
  },
  {
    version: '1.2.0',
    date: 'February 2026',
    highlights: [
      'Marketplace beta — sell presets, guides, and spot packs',
      'Mentorship hub for second-shooter and associate matchmaking',
      'Saved collections + downloadable offline routes',
    ],
  },
];

export default function WhatsNew() {
  return (
    <SettingsScreen title="What's New" subtitle="Release notes">
      {RELEASES.map((r) => (
        <View key={r.version} style={[s.card, r.isLatest && s.cardLatest]}>
          <View style={s.rowTop}>
            <Text style={s.version}>v{r.version}</Text>
            <Text style={s.date}>{r.date}</Text>
            {r.isLatest ? <View style={s.latestPill}><Text style={s.latestPillTxt}>LATEST</Text></View> : null}
          </View>
          {r.highlights.map((h, i) => (
            <View key={i} style={s.bulletRow}>
              <View style={s.bullet} />
              <Text style={s.bulletTxt}>{h}</Text>
            </View>
          ))}
        </View>
      ))}
    </SettingsScreen>
  );
}

const s = StyleSheet.create({
  card: {
    padding: 16, borderRadius: 22, marginBottom: 14,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border, gap: 6,
  },
  cardLatest: { borderColor: 'rgba(245,166,35,0.45)' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  version: { color: colors.text, fontFamily: font.display, fontSize: 18, letterSpacing: -0.3 },
  date: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  latestPill: {
    marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, backgroundColor: colors.primary,
  },
  latestPillTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 2 },
  bullet: {
    width: 4, height: 4, borderRadius: 2, marginTop: 8,
    backgroundColor: colors.primary,
  },
  bulletTxt: {
    flex: 1, color: colors.textSecondary,
    fontFamily: font.body, fontSize: 13.5, lineHeight: 19,
  },
});
