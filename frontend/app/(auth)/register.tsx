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
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from '../../src/auth';
import { colors, font, space } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/ui';
import { formatApiError } from '../../src/api';

export default function Register() {
  const { register, googleExchange } = useAuth();
  const params = useLocalSearchParams<{ specs?: string }>();
  const initialSpecs = (params?.specs ? String(params.specs).split(',').filter(Boolean) : []) as string[];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async () => {
    setError('');
    if (!name || !email || !password) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      await register(email.trim(), password, name.trim(), initialSpecs);
      router.replace('/(tabs)');
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    try {
      // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
      const redirectUrl = Linking.createURL('/auth-callback');
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === 'success' && result.url) {
        const hash = result.url.split('#')[1] || '';
        const params = new URLSearchParams(hash);
        const session_id = params.get('session_id');
        if (session_id) {
          await googleExchange(session_id);
          router.replace('/(tabs)');
        }
      }
    } catch (e) {
      Alert.alert('Google sign-in failed', formatApiError(e));
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="register-back">
            <ArrowLeft color={colors.text} size={22} />
          </TouchableOpacity>

          <Text style={styles.head}>Create account</Text>
          <Text style={styles.sub}>Start logging your shoot locations in seconds.</Text>

          <View style={{ gap: space.lg, marginTop: space.xxl }}>
            <Input
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder="Sophie Reyes"
              testID="register-name"
            />
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              testID="register-email"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 6 characters"
              testID="register-password"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Create account" onPress={onSubmit} loading={loading} testID="register-submit" />
            <View style={styles.divider}>
              <View style={styles.divLine} />
              <Text style={styles.divText}>OR</Text>
              <View style={styles.divLine} />
            </View>
            <Button title="Continue with Google" variant="secondary" onPress={onGoogle} testID="register-google" />
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: space.xxxl }}>
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
  head: { color: colors.text, fontFamily: font.display, fontSize: 36, letterSpacing: -0.6, marginTop: space.xxl },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 15, marginTop: space.sm },
  error: { color: colors.secondary, fontFamily: font.body, fontSize: 13, marginTop: -space.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: space.sm },
  divLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  divText: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 1 },
  footerTxt: { color: colors.textSecondary, fontFamily: font.body },
  footerLink: { color: colors.primary, fontFamily: font.bodySemibold },
});
