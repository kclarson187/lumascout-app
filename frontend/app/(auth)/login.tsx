import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from '../../src/auth';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/ui';
import { formatApiError } from '../../src/api';

export default function Login() {
  const { login, googleExchange } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async () => {
    setError('');
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace('/(tabs)');
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    // May 2026 — routes all Google sign-in failures through the
    // shared helper so users never see a raw axios error code like
    // "Request failed with status code 520" from Cloudflare edge
    // blips. User cancels are silenced (no alert).
    const { runGoogleSignIn } = await import('../../src/google-signin');
    const res = await runGoogleSignIn({ surface: 'login', exchange: googleExchange });
    if (res.kind === 'ok') { router.replace('/(tabs)'); return; }
    if (res.kind === 'cancelled') return;
    Alert.alert(res.title, res.message);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="login-back">
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>

          <Text style={styles.head}>Welcome back</Text>
          <Text style={styles.sub}>Sign in to find your next shoot location.</Text>

          <View style={{ gap: space.lg, marginTop: space.xxl }}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              testID="login-email"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              testID="login-password"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Sign in" onPress={onSubmit} loading={loading} testID="login-submit" />
            <TouchableOpacity
              onPress={() => router.push('/(auth)/forgot-password')}
              style={{ alignSelf: 'center', marginTop: -space.xs }}
              testID="login-forgot"
            >
              <Text style={styles.footerLink}>Forgot password?</Text>
            </TouchableOpacity>
            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.divText}>OR</Text>
              <View style={styles.divLine} />
            </View>
            <Button title="Continue with Google" variant="secondary" onPress={onGoogle} testID="login-google" />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: space.xxxl }}>
            <Text style={styles.footerTxt}>New here? </Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/register')} testID="login-goto-register">
              <Text style={styles.footerLink}>Create account</Text>
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
  back: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: space.lg,
  },
  head: {
    color: colors.text, fontFamily: font.display, fontSize: 36, letterSpacing: -0.6, marginTop: space.xxl,
  },
  sub: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 15, marginTop: space.sm,
  },
  error: {
    color: colors.secondary, fontFamily: font.body, fontSize: 13, marginTop: -space.sm,
  },
  divider: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: space.sm,
  },
  divLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  divText: {
    color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 1,
  },
  footerTxt: { color: colors.textSecondary, fontFamily: font.body },
  footerLink: { color: colors.primary, fontFamily: font.bodySemibold },
});
