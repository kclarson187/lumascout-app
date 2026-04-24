import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image, ActivityIndicator, Platform, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, MessageSquare, ShieldCheck, Star, MapPin, Send, Users as UsersIcon, Inbox, Eye, Briefcase, BarChart3, Share2 } from 'lucide-react-native';
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

// PRD #13: Shoot-style filter chips. Keep the list ~10 items so the chip
// row stays single-line scrollable rather than wrapping.
const SHOOT_NICHES = [
  'Wedding', 'Portrait', 'Family', 'Maternity', 'Newborn',
  'Pet', 'Real Estate', 'Landscape', 'Street', 'Events',
  'Brand', 'Fashion', 'Food', 'Sports',
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
  if (u.plan === 'elite') return <View style={[s.badge, { backgroundColor: colors.primary, borderColor: colors.primary }]}><Star size={9} color={colors.textInverse} fill={colors.textInverse} strokeWidth={0}/><Text style={[s.badgeTxt,{color:colors.textInverse}]}>Featured</Text></View>;
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
  // PRD #13: Shoot-style filter chips. When a niche is active, we pipe the
  // keyword into /network/search (backend matches specialties + bio text).
  // When null, we fall back to the rails view.
  const [niche, setNiche] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/network/discover', { limit_per_rail: 10 });
      setRails(r || {});
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounced search — now niche-aware. Treat niche as an additional query
  // term so backend specialty matching fires.
  useEffect(() => {
    const effective = [q.trim(), niche].filter(Boolean).join(' ');
    if (!effective) { setSearchResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get('/network/search', { q: effective, limit: 30 });
        setSearchResults(r.items || []);
      } catch { setSearchResults([]); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, niche]);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>NETWORK</Text>
          <Text style={s.title}>Find photographers</Text>
        </View>
        {/* PRD: Share LumaScout — top-right parity with Home. */}
        <Pressable
          onPress={async () => {
            try {
              await Share.share({
                message: 'Join me on LumaScout — find amazing photo spots, connect with photographers 📸\n\nhttps://lumascout.app',
                url: 'https://lumascout.app',
                title: 'LumaScout',
              });
            } catch {}
          }}
          style={s.headerShareBtn}
          testID="network-share-app"
        >
          <Share2 size={18} color={colors.primary} />
        </Pressable>
      </View>
      {/* Search bar gets its own full-width row so it never competes with
          the action pills for horizontal space (was squishing the input to
          just the magnifier icon on smaller devices). */}
      <View style={{ paddingHorizontal: space.xl }}>
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
      </View>
      {/* Action pills — horizontally scrollable so we can keep adding
          (Messages, Viewers, Gigs, Analytics...) without squeezing. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={s.actionStripWrap}
        contentContainerStyle={s.actionStrip}
      >
        <Pressable onPress={() => router.push('/inbox' as any)} style={s.inboxBtn} testID="network-inbox">
          <Inbox size={16} color={colors.text} />
          <Text style={s.inboxBtnTxt}>Messages</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/profile-viewers' as any)} style={s.inboxBtn} testID="network-viewers">
          <Eye size={16} color={colors.primary} />
          <Text style={[s.inboxBtnTxt, { color: colors.primary }]}>Viewers</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/referrals' as any)} style={s.inboxBtn} testID="network-referrals">
          <Briefcase size={16} color={colors.primary} />
          <Text style={[s.inboxBtnTxt, { color: colors.primary }]}>Gigs</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/analytics' as any)} style={s.inboxBtn} testID="network-analytics">
          <BarChart3 size={16} color={colors.primary} />
          <Text style={[s.inboxBtnTxt, { color: colors.primary }]}>Analytics</Text>
        </Pressable>
      </ScrollView>

      {/* PRD #13: Shoot-style filter chips. Horizontal scroll so we can keep
          adding niches without squeezing the layout. Tapping "All" clears
          the filter, any niche toggles the search by that specialty.
          FIX: explicit chip height + alignItems:center on the ScrollView
          so chips no longer stretch vertically with varying text length. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={s.nicheStripWrap}
        contentContainerStyle={s.nicheStrip}
      >
        <Pressable
          onPress={() => setNiche(null)}
          style={[s.nicheChip, !niche && s.nicheChipActive]}
          testID="niche-all"
        >
          <Text style={[s.nicheChipTxt, !niche && { color: colors.textInverse }]}>All</Text>
        </Pressable>
        {SHOOT_NICHES.map((n) => {
          const active = niche === n;
          return (
            <Pressable
              key={n}
              onPress={() => setNiche(active ? null : n)}
              style={[s.nicheChip, active && s.nicheChipActive]}
              testID={`niche-${n.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <Text style={[s.nicheChipTxt, active && { color: colors.textInverse }]}>{n}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

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
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerShareBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
  },
  kicker: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  searchInp: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14, padding: 0 },
  actionStripWrap: {
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 52,
  },
  actionStrip: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    gap: 8,
    alignItems: 'center',
  },
  inboxBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inboxBtnTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12.5, lineHeight: 15, includeFontPadding: false },
  railTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15, marginBottom: 8, marginTop: 6 },
  card: { width: 160, padding: 10, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, gap: 4, marginBottom: 10 },
  avatar: { width: 56, height: 56, borderRadius: 28, marginBottom: 4 },
  name: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  spec: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: radii.pill, borderWidth: 1 },
  badgeTxt: { fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase' },
  empty: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', marginTop: space.lg },
  // PRD #13: Niche filter chip strip
  nicheStripWrap: {
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 52,
  },
  nicheStrip: {
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    gap: 8,
    alignItems: 'center',
  },
  nicheChip: {
    height: 32,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nicheChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  nicheChipTxt: {
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 12.5,
    letterSpacing: 0.2,
    lineHeight: 15,
    includeFontPadding: false,
  },
});
