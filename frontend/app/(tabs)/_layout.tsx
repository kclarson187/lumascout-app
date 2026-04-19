import React from 'react';
import { Tabs } from 'expo-router';
import { Home, Map, Plus, Bookmark, User } from 'lucide-react-native';
import { View, StyleSheet, Platform } from 'react-native';
import { colors, font } from '../../src/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: 'rgba(20,20,22,0.98)',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 92 : 74,
          paddingTop: 10,
          paddingBottom: Platform.OS === 'ios' ? 30 : 12,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: {
          fontFamily: font.bodyMedium,
          fontSize: 10,
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Home size={22} color={color} />,
          tabBarButtonTestID: 'tab-home',
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color }) => <Map size={22} color={color} />,
          tabBarButtonTestID: 'tab-explore',
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Add Spot',
          tabBarIcon: ({ color }) => (
            <View style={styles.addBtn}>
              <Plus size={22} color={colors.textInverse} />
            </View>
          ),
          tabBarButtonTestID: 'tab-add',
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color }) => <Bookmark size={22} color={color} />,
          tabBarButtonTestID: 'tab-saved',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <User size={22} color={color} />,
          tabBarButtonTestID: 'tab-profile',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -14,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
