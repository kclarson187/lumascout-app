import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  TextInput,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { LogOut, Settings, BarChart3, Crown, Check, Edit3 } from 'lucide-react-native';
import { useAuth } from '../../src/auth';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii, SHOOT_TYPES } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input, Chip } from '../../src/components/ui';
import SpotCard from '../../src/components/SpotCard';

export default function Profile() {
  const { user, logout, updateProfile } = useAuth();
  const [mySpots, setMySpots] = useState<any[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || '',
    bio: user?.bio || '',
    city: user?.city || '',
    state: user?.state || '',
    instagram: user?.instagram || '',
    website: user?.website || '',
    specialties: user?.specialties || [],
  });

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const s = await api.get('/me/spots');
      setMySpots(s);
    } catch {}
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (user && !editMode) {
      setForm({
        name: user.name || '',
        bio: user.bio || '',
        city: user.city || '',
        state: user.state || '',
        instagram: user.instagram || '',
        website: user.website || '',
        specialties: user.specialties || [],
      });
    }
  }, [user, editMode]);

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: space.xl }}>
        <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 28 }}>Sign in</Text>
        <Button title="Sign in" onPress={() => router.push('/(auth)/login')} />
      </SafeAreaView>
    );
  }

  const saveProfile = async () => {
    try {
      await updateProfile(form);
      setEditMode(false);
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    }
  };

  const toggleSpecialty = (s: string) => {
    setForm({
      ...form,
      specialties: form.specialties.includes(s)
        ? form.specialties.filter((x) => x !== s)
        : [...form.specialties, s],
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setEditMode(!editMode)} style={styles.iconBtn} testID="profile-edit">
            <Edit3 size={18} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              Alert.alert('Sign out?', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => { logout(); router.replace('/onboarding'); } },
              ]);
            }}
            style={styles.iconBtn}
            testID="profile-logout"
          >
            <LogOut size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.headerCard}>
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 36 }}>
                {user.name?.[0]?.toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.handle}>@{user.username}</Text>
          {user.verification_status === 'verified' && (
            <View style={styles.badge}>
              <Check size={12} color={colors.textInverse} />
              <Text style={styles.badgeText}>Verified contributor</Text>
            </View>
          )}
          {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
          {user.city ? <Text style={styles.city}>{user.city}{user.state ? `, ${user.state}` : ''}</Text> : null}
          {(user.specialties && user.specialties.length > 0) && (
            <View style={styles.specs}>
              {user.specialties.map((s: string) => (
                <View key={s} style={styles.specPill}><Text style={styles.specTxt}>{s}</Text></View>
              ))}
            </View>
          )}
        </View>

        {editMode && (
          <View style={styles.editCard}>
            <Input label="Name" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} testID="profile-name" />
            <Input label="Bio" value={form.bio} onChangeText={(t) => setForm({ ...form, bio: t })} multiline style={{ minHeight: 80 }} />
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 2 }}>
                <Input label="City" value={form.city} onChangeText={(t) => setForm({ ...form, city: t })} />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="State" value={form.state} onChangeText={(t) => setForm({ ...form, state: t })} />
              </View>
            </View>
            <Input label="Instagram" value={form.instagram} onChangeText={(t) => setForm({ ...form, instagram: t })} autoCapitalize="none" />
            <Input label="Website" value={form.website} onChangeText={(t) => setForm({ ...form, website: t })} autoCapitalize="none" />
            <Text style={{ color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>Specialties</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SHOOT_TYPES.map((s) => (
                <Chip key={s} label={s} active={form.specialties.includes(s)} onPress={() => toggleSpecialty(s)} />
              ))}
            </View>
            <Button title="Save" onPress={saveProfile} testID="profile-save" />
          </View>
        )}

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/creator-dashboard')} testID="profile-dashboard">
            <BarChart3 size={18} color={colors.primary} />
            <Text style={styles.actionTxt}>Creator{'\n'}Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/paywall')} testID="profile-paywall">
            <Crown size={18} color={colors.primary} />
            <Text style={styles.actionTxt}>Upgrade{'\n'}to Pro</Text>
          </TouchableOpacity>
          {user.role === 'admin' && (
            <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/admin')} testID="profile-admin">
              <Settings size={18} color={colors.primary} />
              <Text style={styles.actionTxt}>Admin{'\n'}Panel</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ paddingHorizontal: space.xl, marginTop: space.lg }}>
          <Text style={styles.sectionTitle}>My Spots · {mySpots.length}</Text>
        </View>
        <View style={{ paddingHorizontal: space.xl, gap: space.md, marginTop: space.md }}>
          {mySpots.length === 0 ? (
            <Text style={{ color: colors.textSecondary, fontFamily: font.body }}>You haven't added any spots yet.</Text>
          ) : (
            mySpots.slice(0, 5).map((s) => <SpotCard key={s.spot_id} spot={s} width={undefined as any} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  headerCard: {
    alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.md,
  },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: colors.border, marginBottom: space.md },
  name: { color: colors.text, fontFamily: font.display, fontSize: 30, letterSpacing: -0.3 },
  handle: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13, marginTop: 2 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.success, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radii.pill, marginTop: space.md,
  },
  badgeText: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  bio: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, marginTop: space.md, textAlign: 'center', lineHeight: 20, paddingHorizontal: space.lg },
  city: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 13, marginTop: 6 },
  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md, justifyContent: 'center', paddingHorizontal: space.xl },
  specPill: {
    backgroundColor: colors.surface2, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radii.pill, borderColor: colors.border, borderWidth: 1,
  },
  specTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  editCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    padding: space.lg, borderRadius: radii.lg, gap: space.md,
    margin: space.xl,
  },
  actionsRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: space.xl, marginTop: space.xl,
  },
  actionCard: {
    flex: 1, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    padding: space.md, borderRadius: radii.md, gap: 6,
  },
  actionTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12, lineHeight: 16 },
  sectionTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
});
