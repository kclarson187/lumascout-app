import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  RefreshControl, ActivityIndicator, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, GraduationCap, Search, X, MessageCircle, User as UserIcon } from 'lucide-react-native';
import { api, formatApiError } from '../src/api';
import { colors, font, space, radii } from '../src/theme';
import VerifiedBadge from '../src/components/VerifiedBadge';
import { EmptyState } from '../src/components/ui';

type Mentor = {
  user_id: string;
  name?: string;
  username?: string;
  avatar_url?: string;
  bio?: string;
  city?: string;
  state?: string;
  specialties?: string[];
  years_experience?: number;
  verification_status?: string;
  plan?: string;
};

export default function MentorsScreen() {
  const [tab, setTab] = useState<'mentors' | 'mentees'>('mentors');
  const [items, setItems] = useState<Mentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const endpoint = tab === 'mentors' ? '/mentors' : '/mentees';
      const r = await api.get(endpoint + '?limit=100');
      setItems(r?.items || []);
    } catch (e) {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter((m) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (m.name || '').toLowerCase().includes(q) ||
      (m.city || '').toLowerCase().includes(q) ||
      (m.specialties || []).join(' ').toLowerCase().includes(q)
    );
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="mentors-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>COMMUNITY</Text>
          <Text style={styles.title}>Mentorship</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(['mentors', 'mentees'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => { setLoading(true); setTab(t); }}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            testID={`mentors-tab-${t}`}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {t === 'mentors' ? 'Mentors' : 'Looking for mentor'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchWrap}>
        <Search size={15} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, city, specialty"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          testID="mentors-search"
        />
        {!!query && (
          <TouchableOpacity onPress={() => setQuery('')} testID="mentors-search-clear">
            <X size={15} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: space.xl }} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<GraduationCap size={36} color={colors.primary} />}
            title={tab === 'mentors' ? 'No mentors match yet' : 'No one is looking yet'}
            body={tab === 'mentors'
              ? 'Try adjusting your search. Or toggle to the "Looking for mentor" tab.'
              : 'Come back soon — this tab updates as photographers flag themselves.'}
          />
        ) : (
          filtered.map((m) => (
            <TouchableOpacity
              key={m.user_id}
              style={styles.card}
              onPress={() => router.push(`/user/${m.user_id}`)}
              activeOpacity={0.85}
            >
              {m.avatar_url ? (
                <Image source={{ uri: m.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <UserIcon size={24} color={colors.textSecondary} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={styles.name}>{m.name || m.username || 'Photographer'}</Text>
                  <VerifiedBadge status={m.verification_status} variant="inline" size={13} />
                  {m.plan && m.plan !== 'free' && (
                    <View style={styles.planPill}>
                      <Text style={styles.planPillTxt}>{m.plan.toUpperCase()}</Text>
                    </View>
                  )}
                </View>
                {!!(m.city || m.state) && (
                  <Text style={styles.meta}>{[m.city, m.state].filter(Boolean).join(', ')}{m.years_experience ? `  ·  ${m.years_experience} yrs` : ''}</Text>
                )}
                {!!m.bio && <Text style={styles.bio} numberOfLines={2}>{m.bio}</Text>}
                {!!(m.specialties && m.specialties.length) && (
                  <View style={styles.chipRow}>
                    {m.specialties.slice(0, 4).map((s) => (
                      <View key={s} style={styles.chip}><Text style={styles.chipTxt}>{s}</Text></View>
                    ))}
                  </View>
                )}
              </View>
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation?.();
                  router.push(`/messages/new?user=${m.user_id}`);
                }}
                style={styles.msgBtn}
                testID={`mentors-msg-${m.user_id}`}
              >
                <MessageCircle size={16} color={colors.primary} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.8 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.3 },

  tabs: { flexDirection: 'row', paddingHorizontal: space.xl, gap: 8, marginBottom: space.md },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12 },
  tabTxtActive: { color: colors.textInverse },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: space.xl, paddingHorizontal: 12, paddingVertical: Platform.select({ ios: 10, android: 6 }), backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14, padding: 0 },

  card: { flexDirection: 'row', gap: 12, padding: space.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, alignItems: 'flex-start' },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  bio: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.surface2, borderRadius: radii.pill },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10 },
  planPill: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: 'rgba(245,166,35,0.15)', borderColor: 'rgba(245,166,35,0.4)', borderWidth: 1, borderRadius: radii.pill },
  planPillTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  msgBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(245,166,35,0.12)', borderColor: 'rgba(245,166,35,0.3)', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
