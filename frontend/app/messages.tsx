/**
 * Legacy redirect — /messages → /inbox
 * This file existed before the Phase A DM system. It now transparently
 * redirects to the canonical /inbox so any old links keep working.
 */
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../src/theme';

export default function MessagesLegacyRedirect() {
  useEffect(() => {
    router.replace('/inbox' as any);
  }, []);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
