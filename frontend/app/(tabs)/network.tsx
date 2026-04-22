import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, MessageSquare, ShieldCheck, Star, MapPin, Send, Users as UsersIcon, Inbox, Eye, Briefcase } from 'lucide-react-native';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';

const RAIL_ORDER: Array<{ key: string; title: string }> = [
  { key: 'near_you', title: 'Near you' },
  { key: 'verified_pros', title: 'Verified pros' },
  { key: 'available_for_second_shooter', title: 'Available for second shooter' },
  { key: 'available_for_referrals', title: 'Available for referrals' },
  { key: 'top_contributors', title: 'Top contributors' },
  { key: 'wedding', title: 'Wedding photographers' },
  { key: 'family', title: 'Family photographers' },
  { key: 'pet', title: 'Pet photographers' },
  { key: 'popular_in_city', title: 'Popular in your city' },
  { key: 'new_members', title: 'New members' },
];

function Badge({ u }: { u: any }) {
  if (u.verification_status === 'verified') {
    return (
      <View style={[s.badge, { backgroundColor: 'rgba(59,130,246,0.14)', borderColor: 'rgba(59,130,246,0.4)' }]}>
        <ShieldCheck size={9} color="#3b82f6" />
        <Text style={[s.badgeTxt, { color: '#3b82f6' }]}>Verified</Text>
      </View>
    );
  }
  if (u.plan === 'elite') return <View style={[s.badge, { backgroundColor: 'rgba(236,72,153,0.14)', borderColor: 'rgba(236,72,153,0.4)' }]}><Star size={9} color="#ec4899"/><Text style={[s.badgeTxt,{color:'#ec4899'}]}>Elite</Text></View>;
  if (u.plan === 'pro')   return <View style={[s.badge, { backgroundColor: 'rgba(245,166,35,0.14)', borderColor: 'rgba(245,166,35,0.4)' }]}><Star size={9} color={colors.primary}/><Text style={[s.badgeTxt,{color:colors.primary}]}>Pro</Text></View>;
  return null;
}

function UserCard({ u }: { u: any }) {
  return (
    <Pressable onPress={() => router.push(`/user/${u.user_id}` as any)} style={s.card} testID={`people-${u.user_id}`}>
      {u.avatar_url ? (
        <Image source={{ uri: u.avatar_url }} style={s.avatar} />
      ) : (
        <View style={[s.avatar, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: colors.textSecondary, fontFamily: font.bodyBold }}>{u.name?.[0]?.toUpperCase() || '?'}</Text>
        </View>
      )}
      <Text style={s.name} numberOfLines={1}>{u.name || '@'+u.username}</Text>
      <Text style={s.meta} numberOfLines={1}>
        {u.city ? <>{u.city}{u.state ? `, ${u.state}` : ''}</> : 'Photographer'}
      </Text>
      {u.specialties ? (
        <Text style={s.spec} numberOfLines={1}>
          {Array.isArray(u.specialties) ? u.specialties.slice(0,2).join(' · ') : String(u.specialties).slice(0,40)}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
        <Badge u={u} />
        {u.available_for_referrals ? <View style={[s.badge,{backgroundColor:'rgba(34,197,94,0.14)',borderColor:'rgba(34,197,94,0.4)'}]}><Send size={9} color={colors.success}/><Text style={[s.badgeTxt,{color:colors.success}]}>Referrals</Text></View> : null}
        {u.available_for_second_shooter ? <View style={[s.badge,{backgroundColor:'rgba(168,85,247,0.14)',borderColor:'rgba(168,85,247,0.4)'}]}><UsersIcon size={9} color="#a855f7"/><Text style={[s.badgeTxt,{color:'#a855f7'}]}>2nd Shooter</Text></View> : null}
      </View>
    </Pressable>
  );
}

export default function NetworkTab() {
  const [rails, setRails] = useState<Record<string, any[]>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/network/discover', { limit_per_rail: 10 });
      setRails(r || {});
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounced search
  useEffect(() => {
    if (!q.trim()) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get('/network/search', { q: q.trim(), limit: 30 });
        setSearchResults(r.items || []);
      } catch { setSearchResults([]); }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <Text style={s.kicker}>NETWORK</Text>
        <Text style={s.title}>Find photographers</Text>
      </View>
      <View style={{ paddingHorizontal: space.xl, flexDirection: 'row', gap: 8 }}>
        <View style={s.searchBar}>
          <Search size={16} color={colors.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by name, city, niche…"
            placeholderTextColor={colors.textTertiary}
            style={s.searchInp}
            testID="network-search"
          />
        </View>
        <Pressable onPress={() => router.push('/inbox' as any)} style={s.inboxBtn} testID="network-inbox">
          <Inbox size={18} color={colors.text} />
          <Text style={s.inboxBtnTxt}>Messages</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/profile-viewers' as any)} style={s.inboxBtn} testID="network-viewers">
          <Eye size={18} color={colors.primary} />
          <Text style={[s.inboxBtnTxt, { color: colors.primary }]}>Viewers</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/referrals' as any)} style={s.inboxBtn} testID="network-referrals">
          <Briefcase size={18} color={colors.primary} />
          <Text style={[s.inboxBtnTxt, { color: colors.primary }]}>Gigs</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 80, gap: space.lg }}>
          {searchResults !== null ? (
            <View style={{ paddingHorizontal: space.xl, paddingTop: space.md, gap: 8 }}>
              <Text style={s.railTitle}>{searchResults.length} result{searchResults.length === 1 ? '' : 's'}</Text>
              {searchResults.length === 0 ? (
                <Text style={s.empty}>No photographers match. Try a broader search.</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {searchResults.map((u) => <UserCard key={u.user_id} u={u} />)}
                </View>
              )}
            </View>
          ) : (
            RAIL_ORDER.map((rail) => {
              const items = (rails as any)[rail.key] || [];
              if (items.length === 0) return null;
              return (
                <View key={rail.key}>
                  <Text style={[s.railTitle, { paddingHorizontal: space.xl }]}>{rail.title}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.xl, gap: 10 }}>
                    {items.map((u: any) => <UserCard key={u.user_id} u={u} />)}
                  </ScrollView>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.sm },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  searchInp: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14, padding: 0 },
  inboxBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  inboxBtnTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },
  railTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15, marginBottom: 8, marginTop: 6 },
  card: { width: 160, padding: 10, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, gap: 4, marginBottom: 10 },
  avatar: { width: 56, height: 56, borderRadius: 28, marginBottom: 4 },
  name: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  spec: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1 },
  badgeTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase' },
  empty: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: space.lg },
});
