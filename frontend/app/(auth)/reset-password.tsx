import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/ui';

export default function ResetPassword() {
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState<string>(String(params.token || ''));
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit = useMemo(() => {
    return token.trim().length > 10 && pw.length >= 8 && pw === pw2 && !loading;
  }, [token, pw, pw2, loading]);

  const onSubmit = async () => {
    setError('');
    if (pw.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (pw !== pw2)   { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token: token.trim(), new_password: pw });
      setDone(true);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="rp-back">
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>

          {!done ? (
            <>
              <View style={styles.bubble}>
                <KeyRound color={colors.primary} size={22} />
              </View>
              <Text style={styles.head}>Create a new password</Text>
              <Text style={styles.sub}>Must be at least 8 characters. Pick something you'll remember.</Text>

              <View style={{ gap: space.lg, marginTop: space.xxl }}>
                {!params.token && (
                  <Input
                    label="Reset token"
                    value={token}
                    onChangeText={setToken}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Paste the token from the email link"
                    testID="rp-token"
                  />
                )}
                <Input
                  label="New password"
                  value={pw}
                  onChangeText={setPw}
                  secureTextEntry
                  placeholder="••••••••"
                  testID="rp-password"
                />
                <Input
                  label="Confirm new password"
                  value={pw2}
                  onChangeText={setPw2}
                  secureTextEntry
                  placeholder="••••••••"
                  testID="rp-password2"
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button
                  title="Update password"
                  onPress={onSubmit}
                  loading={loading}
                  disabled={!canSubmit}
                  testID="rp-submit"
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
              <Text style={styles.head}>Password updated</Text>
              <Text style={styles.sub}>You can now sign in with your new password.</Text>
              <View style={{ marginTop: space.xxl }}>
                <Button title="Sign in" onPress={() => router.replace('/(auth)/login')} testID="rp-goto-login" />
              </View>
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
});
