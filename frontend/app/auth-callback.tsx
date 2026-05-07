import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useAuth } from '../src/auth';
import { colors, font } from '../src/theme';
import { mapExchangeError } from '../src/google-signin';

export default function AuthCallback() {
  const { googleExchange } = useAuth();
  const processed = useRef(false);
  const [status, setStatus] = useState<'signing' | 'error'>('signing');

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    (async () => {
      try {
        const url = await Linking.getInitialURL();
        if (url) {
          const hash = url.split('#')[1] || '';
          const params = new URLSearchParams(hash);
          const session_id = params.get('session_id');
          if (session_id) {
            try {
              await googleExchange(session_id);
              router.replace('/(tabs)');
              return;
            } catch (e: any) {
              // May 2026 — translate axios errors into friendly copy
              // rather than silently bouncing the user back to the
              // login screen (which left them wondering what went
              // wrong on the 520/5xx upstream path).
              const mapped = mapExchangeError(e);
              setStatus('error');
              Alert.alert(mapped.title, mapped.message, [
                { text: 'OK', onPress: () => router.replace('/(auth)/login') },
              ]);
              return;
            }
          }
        }
      } catch {}
      router.replace('/(auth)/login');
    })();
  }, [googleExchange]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      {status === 'signing' ? (
        <>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.textSecondary, fontFamily: font.body }}>Signing you in…</Text>
        </>
      ) : (
        <Text style={{ color: colors.textSecondary, fontFamily: font.body }}>Returning to sign-in…</Text>
      )}
    </View>
  );
}
