import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Mail, CheckCircle2 } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/ui';

type SentState = {
  // SECURITY (Batch #6, May 2026): production API MUST NOT return
  // reset_token / reset_link. These fields are retained here as optional
  // so an older dev-mode backend (EXPOSE_DEV_RESET_TOKEN=1) can still
  // surface them via the __DEV__-gated panel below — never in a release
  // build. Do NOT consume these fields outside the __DEV__ branch.
  reset_token?: string;
  reset_link?: string;
  dev_mode?: boolean;
  expires_at?: string;
  message?: string;
};

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<SentState | null>(null);

  const isValidEmail = useMemo(() => /^\S+@\S+\.\S+$/.test(email.trim()), [email]);

  const onSubmit = async () => {
    setError('');
    if (!isValidEmail) {
      setError('Enter a valid email to continue.');
      return;
    }
    setLoading(true);
    try {
      const resp = await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      setSent(resp);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const goResetWithToken = () => {
    if (!sent?.reset_token) return;
    router.push(`/(auth)/reset-password?token=${sent.reset_token}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="fp-back">
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>

          {!sent ? (
            <>
              <View style={styles.bubble}>
                <Mail color={colors.primary} size={22} />
              </View>
              <Text style={styles.head}>Forgot your password?</Text>
              <Text style={styles.sub}>
                Enter the email you used to sign up and we'll send you a link to create a new one.
              </Text>

              <View style={{ gap: space.lg, marginTop: space.xxl }}>
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="you@example.com"
                  testID="fp-email"
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button
                  title="Send reset link"
                  onPress={onSubmit}
                  loading={loading}
                  testID="fp-submit"
                />
                <TouchableOpacity onPress={() => router.replace('/(auth)/login')} style={{ alignSelf: 'center' }}>
                  <Text style={styles.link}>Back to sign in</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.bubble, { backgroundColor: 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.45)' }]}>
                <CheckCircle2 color="#4ade80" size={22} />
              </View>
              <Text style={styles.head}>Check your email</Text>
              <Text style={styles.sub}>
                {sent.message || "If an account with that email exists, we've sent a reset link."}
              </Text>

              {/* DEV-ONLY helper (Batch #6, May 2026).
                  Hidden in every release build via __DEV__ guard. Also
                  guarded on `sent.dev_mode` so even in dev a production
                  API that doesn't emit the token won't trigger this
                  panel. NEVER rely on this shortcut in QA/TestFlight — the
                  backend requires `EXPOSE_DEV_RESET_TOKEN=1` to include
                  the token in the response, and that flag stays OFF on
                  every deployed environment. The canonical flow is:
                  submit email → check inbox → tap emailed link. */}
              {__DEV__ && sent.dev_mode && sent.reset_token ? (
                <View style={styles.devBox}>
                  <Text style={styles.devBadge}>DEV BUILD ONLY</Text>
                  <Text style={styles.devTitle}>Reset link preview</Text>
                  <Text style={styles.devBody}>
                    Email delivery is not wired for this local environment.
                    This panel only appears in development builds and is
                    always hidden in TestFlight, Play Internal Testing, and
                    App Store releases.
                  </Text>
                  {sent.expires_at && (
                    <Text style={styles.devMeta}>
                      Token expires at {new Date(sent.expires_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: space.md }}>
                    <TouchableOpacity style={styles.devCta} onPress={goResetWithToken} testID="fp-continue-to-reset">
                      <Text style={styles.devCtaTxt}>Continue to reset (dev)</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={() => router.replace('/(auth)/login')}
                style={{ alignSelf: 'center', marginTop: space.xl }}
              >
                <Text style={styles.link}>Back to sign in</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg },
  bubble: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(32,130,255,0.12)', borderWidth: 1, borderColor: 'rgba(32,130,255,0.35)',
    marginBottom: space.lg,
  },
  head: { color: colors.text, fontFamily: font.display, fontSize: 32, letterSpacing: -0.6 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 15, marginTop: space.sm, lineHeight: 22 },
  error: { color: colors.secondary, fontFamily: font.body, fontSize: 13, marginTop: -space.sm },
  link: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 14 },
  devBox: {
    marginTop: space.xl,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg,
    padding: space.md,
  },
  devBadge: {
    alignSelf: 'flex-start',
    color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 1.2,
    backgroundColor: 'rgba(32,130,255,0.1)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill,
    marginBottom: 8,
  },
  devTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  devBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 18, marginTop: 4 },
  devMeta: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 6 },
  devCta: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radii.md,
  },
  devCtaTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
  devCopy: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: radii.md,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  devCopyTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12 },
});
