/**
 * Shared layout primitives for premium settings sub-screens.
 *
 *   <SettingsScreen title="Privacy Policy" subtitle="Last updated Apr 2026">
 *     <Section label="WHAT WE COLLECT">
 *       <Para>...</Para>
 *     </Section>
 *   </SettingsScreen>
 */
import React, { ReactNode } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { colors, font, space } from '../theme';

export function SettingsScreen({
  title, subtitle, children, footer, scrollable = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  scrollable?: boolean;
}) {
  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      <View style={s.head}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {scrollable ? (
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[s.scroll, { flex: 1 }]}>{children}</View>
        )}
        {footer ? <View style={s.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Section({ label, children, helper }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={s.sectionLabel}>{label}</Text>
      {helper ? <Text style={s.sectionHelper}>{helper}</Text> : null}
      <View style={s.card}>{children}</View>
    </View>
  );
}

export function Para({ children }: { children: ReactNode }) {
  return <Text style={s.para}>{children}</Text>;
}

export function Pill({
  label, active, onPress, accent,
}: { label: string; active?: boolean; onPress: () => void; accent?: string }) {
  const tint = accent || colors.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[
        s.pill,
        active && { borderColor: tint + 'cc', backgroundColor: tint + '20' },
      ]}
    >
      <Text style={[s.pillTxt, active && { color: tint, fontFamily: font.bodyBold }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Toggle({
  label, helper, value, onChange,
}: { label: string; helper?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {helper ? <Text style={s.rowHelper}>{helper}</Text> : null}
      </View>
      <View style={[s.switch, value && s.switchOn]}>
        <View style={[s.switchKnob, value && s.switchKnobOn]} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.xl, paddingTop: 4, paddingBottom: 8,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 1 },
  scroll: { paddingHorizontal: space.xl, paddingTop: 6, paddingBottom: 80 },
  sectionLabel: {
    color: colors.primary, fontFamily: font.bodyBold,
    fontSize: 10, letterSpacing: 1.0, marginBottom: 6, paddingLeft: 4,
  },
  sectionHelper: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 12,
    marginBottom: 8, paddingLeft: 4, lineHeight: 17,
  },
  card: {
    borderRadius: 22, backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    padding: 14, gap: 10,
  },
  para: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 13.5,
    lineHeight: 20,
  },
  pill: {
    paddingHorizontal: 12, height: 34, borderRadius: 17,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  pillTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingVertical: 6,
  },
  rowLabel: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  rowHelper: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
  switch: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: colors.surface2, padding: 2, justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.primary },
  switchKnob: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#fff', alignSelf: 'flex-start',
  },
  switchKnobOn: { alignSelf: 'flex-end' },
  footer: {
    paddingHorizontal: space.xl, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
