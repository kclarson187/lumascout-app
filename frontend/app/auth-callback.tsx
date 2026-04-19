import React, { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useAuth } from '../src/auth';
import { colors, font } from '../src/theme';

export default function AuthCallback() {
  const { googleExchange } = useAuth();
  const processed = useRef(false);

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
            await googleExchange(session_id);
            router.replace('/(tabs)');
            return;
          }
        }
      } catch {}
      router.replace('/(auth)/login');
    })();
  }, [googleExchange]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.textSecondary, fontFamily: font.body }}>Signing you in…</Text>
    </View>
  );
}
