import React from 'react';
import { Tabs } from 'expo-router';
import { Home, Map, Plus, Users, User } from 'lucide-react-native';
import { View, StyleSheet, Platform } from 'react-native';
import { colors, font } from '../../src/theme';

/**
 * 5-tab bottom nav for the photographer-network pivot:
 *   Home · Explore · ➕ Add · Network · Profile
 * Inbox is accessed via the bell on Home header and a prominent "Messages"
 * entry inside Network tab. Saved stays reachable from the Profile screen.
 */
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
        tabBarLabelStyle: { fontFamily: font.bodyMedium, fontSize: 10, letterSpacing: 0.3 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({color}) => <Home size={22} color={color}/>, tabBarButtonTestID: 'tab-home' }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore', tabBarIcon: ({color}) => <Map size={22} color={color}/>, tabBarButtonTestID: 'tab-explore' }} />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Add Spot',
          tabBarIcon: () => (<View style={styles.addBtn}><Plus size={22} color={colors.textInverse}/></View>),
          tabBarButtonTestID: 'tab-add',
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen name="network" options={{ title: 'Network', tabBarIcon: ({color}) => <Users size={22} color={color}/>, tabBarButtonTestID: 'tab-network' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({color}) => <User size={22} color={color}/>, tabBarButtonTestID: 'tab-profile' }} />
      {/* Hidden legacy tabs: saved moved off the bottom bar (still reachable from Profile → Saved). */}
      <Tabs.Screen name="saved" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});
