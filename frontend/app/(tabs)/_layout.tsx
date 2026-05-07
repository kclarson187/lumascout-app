import React from 'react';
import { Tabs } from 'expo-router';
import { Home, Map, Plus, Users, User } from 'lucide-react-native';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../../src/theme';
import { useUnreadMessages } from '../../src/hooks/useUnreadMessages';
import { useWebStyles } from '../../src/webStyles';

/**
 * 5-tab bottom nav for the photographer-network pivot:
 *   Home · Explore · ➕ Add · Network · Profile
 * Inbox is accessed via the bell on Home header and a prominent "Messages"
 * entry inside Network tab. Saved stays reachable from the Profile screen.
 *
 * Tier 1 Messaging Upgrade (2026-04): the Profile tab icon now carries a
 * red dot when the viewer has unread DMs. Polling is driven by the shared
 * useUnreadMessages hook so it stays consistent with the home avatar dot.
 */
function ProfileTabIcon({ color }: { color: string }) {
  useWebStyles();
  const unread = useUnreadMessages();
  return (
    <View style={styles.iconWrap}>
      <User size={22} color={color} />
      {unread.total > 0 ? <View style={styles.iconRedDot} /> : null}
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // Android edge-to-edge fix: the OS gesture/3-button nav bar overlays
  // the app, so we must add insets.bottom to the tab bar's height +
  // paddingBottom so the tab labels remain visible above the system
  // nav bar. iOS already handles its home-indicator via the static 30px.
  // Minimum padding (12) ensures legacy 3-button-nav devices still
  // have a comfortable tap zone. Android tab bar grows with the inset
  // so the icons + labels never get clipped by the system chrome.
  const androidBottomPad = Math.max(12, insets.bottom + 8);
  const tabHeight = Platform.OS === 'ios' ? 92 : 64 + androidBottomPad;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarStyle: {
          backgroundColor: 'rgba(20,20,22,0.98)',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: tabHeight,
          paddingTop: 10,
          paddingBottom: Platform.OS === 'ios' ? 30 : androidBottomPad,
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
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <ProfileTabIcon color={color}/>, tabBarButtonTestID: 'tab-profile' }} />
      {/* Hidden legacy tabs: saved moved off the bottom bar (still reachable from Profile → Saved). */}
      <Tabs.Screen name="saved" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  iconWrap: { position: 'relative', width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  iconRedDot: {
    position: 'absolute',
    top: -1,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
    borderColor: 'rgba(20,20,22,1)',
  },
});
