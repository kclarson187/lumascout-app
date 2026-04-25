/**
 * Public email-change verification landing page (Item #8).
 *
 * The link in the verification email points to
 * `https://lumascout.app/verify-email?token=...`. This screen makes the
 * GET to /api/auth/email-change/verify and shows the result.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { api } from '../src/api';
import { colors, font, space } from '../src/theme';

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const t = params.token as string | undefined;
    if (!t) { setState('error'); setMessage('No verification token provided.'); return; }
    (async () => {
      try {
        const r = await api.get(`/auth/email-change/verify?token=${encodeURIComponent(t)}`);
        setState('success');
        setMessage(r?.message || 'Email updated.');
      } catch (e: any) {
        setState('error');
        setMessage(e?.message || e?.detail || 'Could not verify.');
      }
    })();
  }, [params.token]);

  return (
    <SafeAreaView style={s.root} edges={['top','left','right']}>
      <View style={s.body}>
        {state === 'loading' ? (
          <ActivityIndicator color={colors.primary} />
        ) : state === 'success' ? (
          <>
            <View style={[s.icon, { backgroundColor: 'rgba(34,197,94,0.18)' }]}>
              <Check size={26} color="#22c55e" strokeWidth={3} />
            </View>
            <Text style={s.title}>Email verified</Text>
            <Text style={s.body2}>{message}</Text>
          </>
        ) : (
          <>
            <View style={[s.icon, { backgroundColor: 'rgba(239,68,68,0.18)' }]}>
              <X size={26} color="#ef4444" strokeWidth={3} />
            </View>
            <Text style={s.title}>Couldn't verify</Text>
            <Text style={s.body2}>{message}</Text>
          </>
        )}
        <Pressable onPress={() => router.replace('/(tabs)')} style={s.cta}>
          <Text style={s.ctaTxt}>Continue to LumaScout</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: 14 },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  body2: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  cta: { marginTop: 22, height: 46, paddingHorizontal: 22, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: '#1a1300', fontFamily: font.bodyBold, fontSize: 14 },
});
