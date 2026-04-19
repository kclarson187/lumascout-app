import React, { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, Modal, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  useFonts,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_600SemiBold_Italic,
} from '@expo-google-fonts/playfair-display';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';
import { onPaywallNeeded } from '../src/api';
import { Crown, X } from 'lucide-react-native';
import { Button } from '../src/components/Button';

function Gate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const seg0 = segments[0] as string | undefined;
    const inAuth = seg0 === '(auth)';
    const inOnboarding = seg0 === 'onboarding';
    const inAuthCb = seg0 === 'auth-callback';

    if (!user && !inAuth && !inOnboarding && !inAuthCb) {
      router.replace('/onboarding');
    } else if (user && (inAuth || inOnboarding || !seg0)) {
      router.replace('/(tabs)');
    }
  }, [user, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_600SemiBold_Italic,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <StatusBar style="light" />
        <Gate />
        <PaywallOverlay />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade',
          }}
        />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function PaywallOverlay() {
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    onPaywallNeeded((m) => setMessage(m));
  }, []);
  if (!message) return null;
  return (
    <Modal transparent animationType="fade" visible>
      <View style={overlayStyles.bg}>
        <View style={overlayStyles.card}>
          <TouchableOpacity onPress={() => setMessage(null)} style={overlayStyles.close} testID="paywall-overlay-close">
            <X size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={overlayStyles.icon}><Crown size={28} color={colors.primary} /></View>
          <Text style={overlayStyles.title}>You've hit your Free limit</Text>
          <Text style={overlayStyles.body}>{message}</Text>
          <Button
            title="See Pro & Elite plans"
            onPress={() => { setMessage(null); router.push('/paywall'); }}
            testID="paywall-overlay-cta"
            style={{ marginTop: space.lg }}
          />
          <TouchableOpacity onPress={() => setMessage(null)} style={{ marginTop: space.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 }}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const overlayStyles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: space.xl },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: colors.surface1,
    borderColor: colors.primary, borderWidth: 1, borderRadius: radii.lg, padding: space.xl,
  },
  close: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  icon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.4)', borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginTop: space.sm,
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24, textAlign: 'center', marginTop: space.md, letterSpacing: -0.3 },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
