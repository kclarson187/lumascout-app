import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Check } from 'lucide-react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';
import SpotCard from '../../src/components/SpotCard';

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<any | null>(null);
  const [spots, setSpots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const p = await api.get(`/users/${id}`);
      setProfile(p);
      const all = await api.get('/spots', { limit: 200 });
      setSpots(all.filter((s: any) => s.owner_user_id === id));
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const toggleFollow = async () => {
    if (!user) return router.push('/(auth)/login');
    await api.post(`/users/${id}/follow`);
    load();
  };

  if (loading || !profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="user-back">
            <ChevronLeft size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.top}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 30 }}>{profile.name?.[0]?.toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.name}>{profile.name}</Text>
          <Text style={styles.handle}>@{profile.username}</Text>
          {profile.verification_status === 'verified' && (
            <View style={styles.verified}>
              <Check size={12} color={colors.textInverse} />
              <Text style={styles.verifiedTxt}>Verified</Text>
            </View>
          )}
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          <View style={styles.stats}>
            <Stat label="Spots" value={profile.stats?.spots || 0} />
            <Stat label="Followers" value={profile.stats?.followers || 0} />
            <Stat label="Following" value={profile.stats?.following || 0} />
          </View>

          {user && user.user_id !== profile.user_id && (
            <Button
              title={profile.is_following ? 'Following' : 'Follow'}
              variant={profile.is_following ? 'secondary' : 'primary'}
              onPress={toggleFollow}
              style={{ marginTop: space.lg, minWidth: 180 }}
              testID="user-follow"
            />
          )}
        </View>

        <View style={{ paddingHorizontal: space.xl, marginTop: space.xl, gap: space.md }}>
          <Text style={styles.sectionTitle}>Contributed spots · {spots.length}</Text>
          {spots.map((s) => <SpotCard key={s.spot_id} spot={s} width={undefined as any} />)}
          {spots.length === 0 && <Text style={{ color: colors.textSecondary, fontFamily: font.body }}>No public spots yet.</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 70 }}>
      <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 22 }}>{value}</Text>
      <Text style={{ color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.xl, paddingTop: space.sm },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  top: { alignItems: 'center', paddingHorizontal: space.xl, marginTop: space.md },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: colors.border, marginBottom: space.md },
  name: { color: colors.text, fontFamily: font.display, fontSize: 28 },
  handle: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13, marginTop: 2 },
  verified: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    backgroundColor: colors.success, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radii.pill, marginTop: space.sm,
  },
  verifiedTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.5 },
  bio: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, marginTop: space.md, textAlign: 'center', paddingHorizontal: space.xl, lineHeight: 20 },
  stats: { flexDirection: 'row', gap: space.xl, marginTop: space.lg },
  sectionTitle: { color: colors.text, fontFamily: font.display, fontSize: 20 },
});
