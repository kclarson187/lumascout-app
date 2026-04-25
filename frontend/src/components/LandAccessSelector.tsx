/**
 * LandAccessSelector — reusable Land Access disclosure (Item #1).
 *
 * Drop into Add Spot, Edit Spot, and Admin spot review forms.
 * State shape:
 *   { land_access: 'public'|'private'|'unsure'|undefined, access_notes: string }
 *
 * UX:
 *   • Pill row of 3 options (Public / Private / Unsure)
 *   • If Private: helper warning + access notes textarea
 *   • Soft-required: parent forms should validate before submit
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { ShieldCheck, Lock, HelpCircle, AlertTriangle } from 'lucide-react-native';
import { colors, font, space } from '../theme';

export type LandAccess = 'public' | 'private' | 'unsure';

export function LandAccessSelector({
  value, accessNotes, onChange, onAccessNotesChange,
}: {
  value?: LandAccess;
  accessNotes?: string;
  onChange: (v: LandAccess) => void;
  onAccessNotesChange: (s: string) => void;
}) {
  const opts: { key: LandAccess; label: string; Icon: any; tint: string }[] = [
    { key: 'public',  label: 'Public land',   Icon: ShieldCheck, tint: '#22c55e' },
    { key: 'private', label: 'Private land',  Icon: Lock,         tint: '#9D59FF' },
    { key: 'unsure',  label: 'Unsure',         Icon: HelpCircle,   tint: '#A1A1AA' },
  ];
  return (
    <View style={s.wrap}>
      <Text style={s.label}>Is this location on public or private land?</Text>
      <View style={s.row}>
        {opts.map((o) => {
          const active = value === o.key;
          const Icon = o.Icon;
          return (
            <Pressable
              key={o.key}
              onPress={() => onChange(o.key)}
              style={[s.pill, active && [s.pillActive, { borderColor: o.tint + 'cc', backgroundColor: o.tint + '20' }]]}
              testID={`land-access-${o.key}`}
            >
              <Icon size={13} color={active ? o.tint : colors.textSecondary} />
              <Text style={[s.pillTxt, active && { color: o.tint, fontFamily: font.bodyBold }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {value === 'private' ? (
        <View style={s.warnBox}>
          <AlertTriangle size={14} color="#F5A623" />
          <Text style={s.warnTxt}>
            Only share locations you have permission to access. Include
            access notes if needed so others can request entry properly.
          </Text>
        </View>
      ) : null}

      {(value === 'private' || value === 'unsure') ? (
        <View style={{ marginTop: 10 }}>
          <Text style={s.subLabel}>Access notes / permission details (optional)</Text>
          <TextInput
            value={accessNotes || ''}
            onChangeText={onAccessNotesChange}
            placeholder="e.g. Owner allows photographers M–F 8am–5pm. Email contact@ranch.com first."
            placeholderTextColor={colors.textTertiary}
            multiline
            style={s.notesInput}
            maxLength={1000}
            testID="land-access-notes"
          />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  label: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, marginBottom: 2 },
  subLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, height: 36, borderRadius: 18,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  pillActive: {},
  pillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12.5 },
  warnBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    padding: 12, borderRadius: 14, borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)', backgroundColor: 'rgba(245,166,35,0.08)',
    marginTop: 4,
  },
  warnTxt: { flex: 1, color: '#F5A623', fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  notesInput: {
    minHeight: 78, textAlignVertical: 'top',
    backgroundColor: colors.surface2, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    padding: 12, color: colors.text, fontFamily: font.body, fontSize: 13.5, lineHeight: 19,
  },
});
