/**
 * Settings ▸ Account ▸ Email Address (Item #8 — Apr 2026)
 *
 * Two-step verified email change. The user enters their new email +
 * current password (skipped for Google-only accounts), we POST to
 * /api/auth/email-change/request, then a verification email is sent
 * to the NEW address. Clicking that link from the new mailbox flips
 * the login email and notifies the old one.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, Alert,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, AtSign, Lock, Check } from 'lucide-react-native';
import { useAuth } from '../../src/auth';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

export default function EmailSettingsScreen() {
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [pw, setPw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const isGoogleOnly = !!user && !((user as any)?.has_password);
  // We don't reliably know `has_password` from /auth/me; default to
  // requiring password if we can't tell. Server validates regardless.
  const requirePassword = true;

  const valid =
    newEmail.includes('@') &&
    newEmail.includes('.') &&
    newEmail.toLowerCase() !== (user?.email || '').toLowerCase() &&
    (!requirePassword || pw.length >= 6);

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const r = await api.post('/auth/email-change/request', {
        new_email: newEmail.trim().toLowerCase(),
        current_password: pw || undefined,
      });
      setSuccess(true);
      Alert.alert(
        'Verify your new email',
        `We sent a verification link to ${newEmail.trim().toLowerCase()}. Open it from that mailbox within 2 hours to finish the change.`,
      );
    } catch (e: any) {
      Alert.alert('Could not change email', e?.message || e?.detail || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.headBtn} hitSlop={10}>
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <Text style={s.headTitle}>Email Address</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: 14 }}>
          <View style={s.card}>
            <Text style={s.kicker}>CURRENT EMAIL</Text>
            <Text style={s.curEmail}>{user?.email || '—'}</Text>
            <Text style={s.helper}>
              We'll send a verification link to your new address. Your
              login email won't change until you click that link.
            </Text>
          </View>

          <View style={s.card}>
            <Text style={s.label}>New email</Text>
            <View style={s.inputWrap}>
              <AtSign size={14} color={colors.textTertiary} />
              <TextInput
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="you@yourdomain.com"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={s.input}
                editable={!success}
                testID="new-email-input"
              />
            </View>

            {requirePassword ? (
              <>
                <Text style={[s.label, { marginTop: 12 }]}>Current password</Text>
                <View style={s.inputWrap}>
                  <Lock size={14} color={colors.textTertiary} />
                  <TextInput
                    value={pw}
                    onChangeText={setPw}
                    placeholder="••••••••"
                    placeholderTextColor={colors.textTertiary}
                    secureTextEntry
                    style={s.input}
                    editable={!success}
                    testID="current-password-input"
                  />
                </View>
                <Text style={s.helper}>
                  We require your current password to confirm it's you.
                </Text>
              </>
            ) : null}
          </View>

          <Pressable
            onPress={submit}
            disabled={!valid || submitting || success}
            style={[s.cta, (!valid || success) && { opacity: 0.5 }]}
            testID="email-change-submit"
          >
            {submitting ? (
              <ActivityIndicator color="#1a1300" />
            ) : success ? (
              <>
                <Check size={16} color="#1a1300" strokeWidth={3} />
                <Text style={s.ctaTxt}>Verification sent</Text>
              </>
            ) : (
              <Text style={s.ctaTxt}>Send verification email</Text>
            )}
          </Pressable>

          <Text style={[s.helper, { textAlign: 'center', marginTop: 16 }]}>
            On change, your subscription, profile, messages, and uploads
            stay intact — only the login identity changes.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.xl, paddingTop: 6, paddingBottom: 8,
  },
  headBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },
  card: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: 22, padding: 16, gap: 8 },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 1 },
  curEmail: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 },
  helper: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  label: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, height: 46,
    backgroundColor: colors.surface2, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  input: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14, padding: 0 },
  cta: {
    height: 50, borderRadius: 25, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 8,
  },
  ctaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 15 },
});
