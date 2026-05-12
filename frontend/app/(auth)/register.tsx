/**
 * Create account screen \u2014 Jun 2025 Phase 1 onboarding v2 refresh.
 *
 * Premium dark UI with adaptive social auth ordering (Apple first on
 * iOS, Google first on Android) + an email path with inline validation.
 *
 * Apple Sign-In is intentionally a "Coming soon" stub this round (see
 * src/components/AppleSoonButton.tsx) \u2014 wiring real SIWA requires an
 * app.json capability + Apple Portal config + backend verification that
 * are tracked as a follow-up.
 *
 * Post-register routing:
 *   \u2022 If ONBOARDING_V2_ENABLED and the new user has basics_complete=false
 *     (the server always sets this for email-path signups that didn't
 *     pass first_name/display_name/home_area at register), push to
 *     /onboarding/basics so the user can fill those in before entering
 *     the app.
 *   \u2022 Otherwise behave like the prior flow and go straight to /(tabs).
 */
import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, Alert, Pressable,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Mail } from 'lucide-react-native';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { FormField } from '../../src/components/FormField';
import { AppleSoonButton } from '../../src/components/AppleSoonButton';
import { formatApiError } from '../../src/api';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';
import { ONBOARDING_V2_ENABLED } from '../../src/constants/flags';

// Minimal email shape check \u2014 server is the source of truth, this is
// purely for inline UX so users don't submit a typo'd address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
  const { register, googleExchange, refresh } = useAuth();
  const params = useLocalSearchParams<{ specs?: string }>();
  const initialSpecs = (params?.specs ? String(params.specs).split(',').filter(Boolean) : []) as string[];

  // 'choose' = show the social/email buttons.
  // 'email'  = show the email + password form.
  const [mode, setMode] = useState<'choose' | 'email'>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [topErr, setTopErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const kbHeight = useKeyboardHeight();

  // Order of social-auth buttons \u2014 per-platform per spec.
  const socialOrder = useMemo(() => {
    return Platform.OS === 'ios' ? ['apple', 'google'] as const : ['google', 'apple'] as const;
  }, []);

  const validateEmail = (v: string): string | null => {
    if (!v.trim()) return 'Enter a valid email address.';
    if (!EMAIL_RE.test(v.trim())) return 'Enter a valid email address.';
    return null;
  };
  const validatePassword = (v: string): string | null => {
    if (v.length < 8) return 'Use at least 8 characters.';
    return null;
  };

  const onSubmit = async () => {
    setTopErr(null);
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    setEmailErr(eErr);
    setPwErr(pErr);
    if (eErr || pErr) return;

    setLoading(true);
    try {
      // We deliberately do NOT pass display_name / first_name / home_area
      // here \u2014 the email path collects them on the next screen so the
      // signup form stays minimal (email + password only).
      await register(email.trim(), password, email.trim().split('@')[0], initialSpecs);
      // Refresh so /auth/me's basics_complete flag reflects reality.
      await refresh();
      if (ONBOARDING_V2_ENABLED) {
        router.replace('/onboarding/basics' as any);
      } else {
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      const raw = String(formatApiError(e) || '');
      // Map known backend strings to the friendlier spec'd copy.
      if (/already.*regist|in use/i.test(raw)) {
        setTopErr('That email is already in use. Try signing in instead.');
      } else if (/email/i.test(raw)) {
        setEmailErr('Enter a valid email address.');
      } else {
        setTopErr("We couldn't create your account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    const { runGoogleSignIn } = await import('../../src/google-signin');
    const res = await runGoogleSignIn({ surface: 'register', exchange: googleExchange });
    if (res.kind === 'ok') {
      await refresh();
      router.replace('/(tabs)');
      return;
    }
    if (res.kind === 'cancelled') return;
    Alert.alert(res.title, res.message);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            Platform.OS === 'android' && kbHeight > 0
              ? { paddingBottom: kbHeight + space.xxxl }
              : null,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="register-back">
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>

          <Text style={styles.head}>Create account</Text>
          <Text style={styles.sub}>
            Find better photo spots. Meet photographers nearby.
          </Text>

          {mode === 'choose' ? (
            <View style={styles.choose}>
              {socialOrder.map((p) => (
                p === 'apple'
                  ? <AppleSoonButton key="apple" testID="register-apple-soon" />
                  : (
                    <TouchableOpacity
                      key="google"
                      onPress={onGoogle}
                      style={styles.googleBtn}
                      testID="register-google"
                      activeOpacity={0.7}
                    >
                      <Text style={styles.googleGlyph}>G</Text>
                      <Text style={styles.googleLabel}>Continue with Google</Text>
                    </TouchableOpacity>
                  )
              ))}

              <View style={styles.divider}>
                <View style={styles.divLine} />
                <Text style={styles.divText}>OR</Text>
                <View style={styles.divLine} />
              </View>

              <TouchableOpacity
                onPress={() => setMode('email')}
                style={styles.emailBtn}
                testID="register-use-email"
                activeOpacity={0.7}
              >
                <Mail size={16} color={colors.text} />
                <Text style={styles.emailBtnTxt}>Continue with Email</Text>
              </TouchableOpacity>

              <Text style={styles.legal}>
                By continuing, you agree to the{' '}
                <Text style={styles.legalLink}>Terms</Text>
                {' '}and{' '}
                <Text style={styles.legalLink}>Community Guidelines</Text>.
              </Text>
            </View>
          ) : (
            <View style={styles.form}>
              <FormField
                label="Email address"
                value={email}
                onChangeText={(v) => { setEmail(v); if (emailErr) setEmailErr(null); }}
                onBlur={() => setEmailErr(validateEmail(email))}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
                required
                error={emailErr}
                testID="register-email"
              />
              <FormField
                label="Password"
                value={password}
                onChangeText={(v) => { setPassword(v); if (pwErr) setPwErr(null); }}
                onBlur={() => setPwErr(validatePassword(password))}
                secureTextEntry
                placeholder="••••••••"
                required
                helper="Use 8+ characters."
                error={pwErr}
                testID="register-password"
              />
              {topErr ? <Text style={styles.topErr}>{topErr}</Text> : null}

              <Button title="Create account" onPress={onSubmit} loading={loading} testID="register-submit" />

              <Pressable onPress={() => setMode('choose')} hitSlop={8} style={styles.altRow}>
                <Text style={styles.altRowTxt}>← Use a different method</Text>
              </Pressable>

              <Text style={styles.legal}>
                By continuing, you agree to the{' '}
                <Text style={styles.legalLink}>Terms</Text>
                {' '}and{' '}
                <Text style={styles.legalLink}>Community Guidelines</Text>.
              </Text>
            </View>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerTxt}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/login')} testID="register-goto-login">
              <Text style={styles.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  scrollContent: { padding: space.xl, paddingBottom: space.xxxl, minHeight: '100%' },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  head: { color: colors.text, fontFamily: font.display, fontSize: 36, letterSpacing: -0.6, marginTop: space.lg },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 15, marginTop: space.sm, lineHeight: 22 },

  choose: { gap: 12, marginTop: space.xxl },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 14, paddingHorizontal: space.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
  },
  googleGlyph: { color: '#1F1F1F', fontFamily: font.bodyBold, fontSize: 17 },
  googleLabel: { color: '#1F1F1F', fontFamily: font.bodySemibold, fontSize: 15 },

  emailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 14, paddingHorizontal: space.lg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
    backgroundColor: colors.surface1,
  },
  emailBtnTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  divLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.15)' },
  divText: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 1 },

  legal: {
    color: colors.textTertiary, fontFamily: font.body, fontSize: 11, lineHeight: 16,
    marginTop: 4, textAlign: 'center',
  },
  legalLink: { color: colors.primary, fontFamily: font.bodySemibold },

  form: { gap: space.md, marginTop: space.xxl },
  topErr: {
    color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 12, lineHeight: 16,
    marginTop: -4,
  },
  altRow: { paddingVertical: 8, alignItems: 'center' },
  altRowTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },

  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: space.xxxl },
  footerTxt: { color: colors.textSecondary, fontFamily: font.body },
  footerLink: { color: colors.primary, fontFamily: font.bodySemibold },
});
