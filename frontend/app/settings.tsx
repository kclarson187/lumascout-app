import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, CreditCard, User, Bell, Shield, Crown, LogOut, Store, PackageOpen, ShieldCheck } from 'lucide-react-native';
import { useAuth } from '../src/auth';
import { colors, font, space, radii } from '../src/theme';

export default function Settings() {
  const { user, logout } = useAuth();
  if (!user) return null;

  const planLabel = (user.plan || 'free').toUpperCase();
  const planColor = user.plan === 'elite' ? colors.primary : user.plan === 'pro' ? colors.info : colors.textSecondary;

  // FIX(Commit 7c / 2026-04): Staff Tools subsection gated to admin roles.
  // Relocated here from the profile scroll so the consumer surface stays
  // consumer-first.
  const STAFF_ROLES = ['admin', 'super_admin', 'moderator'];
  const isStaff = STAFF_ROLES.includes(user.role || '');

  const rows: Array<{
    key: string; icon: React.ReactNode; title: string; subtitle?: string; onPress: () => void; accent?: string;
  }> = [
    { key: 'billing', icon: <CreditCard size={20} color={colors.primary} />, title: 'Plan & billing', subtitle: `Currently on ${planLabel}`, onPress: () => router.push('/billing') },
    { key: 'upgrade', icon: <Crown size={20} color={colors.primary} />, title: user.plan === 'elite' ? 'Manage plan' : 'Upgrade plan', subtitle: user.plan === 'elite' ? 'Elite creator' : 'Go Pro or Elite', onPress: () => router.push('/paywall') },
    { key: 'creator', icon: <PackageOpen size={20} color={colors.primary} />, title: 'Creator studio', subtitle: user.plan === 'elite' ? 'Manage your spot packs' : 'Elite unlocks pack creation', onPress: () => router.push('/creator/packs') },
    { key: 'marketplace', icon: <Store size={20} color={colors.primary} />, title: 'Marketplace', subtitle: 'Explore creator spot packs', onPress: () => router.push('/marketplace') },
    { key: 'profile', icon: <User size={20} color={colors.primary} />, title: 'Edit profile', subtitle: 'Name, bio, specialties, city', onPress: () => router.push('/(tabs)/profile') },
    { key: 'notif', icon: <Bell size={20} color={colors.primary} />, title: 'Notifications', subtitle: 'Push notifications (coming soon)', onPress: () => Alert.alert('Coming soon', 'Push notifications launch with mobile build.') },
    { key: 'privacy', icon: <Shield size={20} color={colors.primary} />, title: 'Privacy defaults', subtitle: 'How new spots are displayed', onPress: () => Alert.alert('Privacy defaults', 'You control each spot\'s privacy when you create it. Bulk defaults land in the next release.') },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="settings-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 80 }}>
        <View style={styles.planCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.planCardLabel}>Current plan</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={[styles.planCardName, { color: planColor }]}>{planLabel}</Text>
              {user.plan !== 'free' && <Text style={styles.planCardSub}>active</Text>}
            </View>
          </View>
          <TouchableOpacity style={styles.planCta} onPress={() => router.push('/billing')} testID="settings-manage">
            <Text style={styles.planCtaTxt}>Manage</Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: space.xl, gap: 8 }}>
          {rows.map((row) => (
            <TouchableOpacity key={row.key} style={styles.row} onPress={row.onPress} testID={`settings-${row.key}`}>
              <View style={styles.rowIcon}>{row.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                {row.subtitle && <Text style={styles.rowSub}>{row.subtitle}</Text>}
              </View>
              <ChevronRight size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>

        {/* FIX(Commit 7c): Staff Tools — only rendered for admin / super_admin / moderator. */}
        {isStaff && (
          <>
            <Text style={styles.staffHeader}>Staff tools</Text>
            <View style={{ gap: 8 }}>
              <TouchableOpacity style={styles.row} onPress={() => router.push('/admin')} testID="settings-staff-admin">
                <View style={styles.rowIcon}><ShieldCheck size={20} color={colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Admin dashboard</Text>
                  <Text style={styles.rowSub}>Users, spots, reports, audit & analytics</Text>
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.row} onPress={() => router.push('/admin/community' as any)} testID="settings-staff-community">
                <View style={styles.rowIcon}><ShieldCheck size={20} color={colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Community Control Center</Text>
                  <Text style={styles.rowSub}>Moderate posts, polls, comments, reports & spam</Text>
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </>
        )}

        <TouchableOpacity
          style={[styles.row, { marginTop: space.xl, borderColor: colors.secondary }]}
          onPress={() => {
            Alert.alert('Sign out?', '', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => { logout(); router.replace('/onboarding'); } },
            ]);
          }}
          testID="settings-logout"
        >
          <View style={styles.rowIcon}><LogOut size={20} color={colors.secondary} /></View>
          <Text style={[styles.rowTitle, { color: colors.secondary }]}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.4 },
  planCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg, backgroundColor: colors.surface1,
    borderColor: colors.primary, borderWidth: 1, borderRadius: radii.lg,
  },
  planCardLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  planCardName: { fontFamily: font.display, fontSize: 32, letterSpacing: -0.3, marginTop: 4 },
  planCardSub: { color: colors.success, fontFamily: font.bodyMedium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  planCta: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  planCtaTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 12 },
  staffHeader: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: space.xl, marginBottom: space.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: space.lg, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.md,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 },
  rowSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
});
