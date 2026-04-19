import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { colors } from '../src/theme';

export default function Index() {
  // Root gate handled in _layout.tsx
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
