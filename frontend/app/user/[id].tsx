import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  ShieldCheck,
  MapPin,
  Globe,
  Instagram,
  Facebook,
  Music2,
  Share2,
  UserPlus,
  UserMinus,
  MessageCircle,
  Briefcase,
  Handshake,
  GraduationCap,
} from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/ui';
import SpotCard from '../../src/components/SpotCard';

type TabKey = 'posts' | 'spots' | 'photos' | 'reviews' | 'about';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'posts', label: 'Posts' },
  { key: 'spots', label: 'Spots' },
  { key: 'photos', label: 'Photos' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'about', label: 'About' },
];

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: me } = useAuth();
  const [profile, setProfile] = useState<any | null>(null);
  const [spots, setSpots] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('spots');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const p = await api.get(`/users/${id}`);
      setProfile(p);
      const [all, postsRes] = await Promise.all([
        api.get('/spots', { limit: 200 }).catch(() => []),
        api.get('/posts', { author_id: id, limit: 20 }).catch(() => ({ items: [] })),
      ]);
      setSpots((Array.isArray(all) ? all : all?.items || []).filter((s: any) => s.owner_user_id === id));
      setPosts(postsRes?.items || []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const toggleFollow = async () => {
    if (!me) return router.push('/(auth)/login');
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/users/${id}/follow`);
      await load();
    } catch (e) {
      Alert.alert('Could not update follow', formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const messageUser = async () => {
    if (!me) return router.push('/(auth)/login');
    if (busy) return;
    setBusy(true);
    try {
      const convo = await api.post('/conversations', { participant_user_id: id });
      router.push(`/messages/${convo.conversation_id}` as any);
    } catch (e) {
      Alert.alert('Could not open message', formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const shareProfile = async () => {
    try {
      await Share.share({
        message: `Check out ${profile?.name}'s photography profile on PhotoScout`,
      });
    } catch {}
  };

  const openUrl = (url?: string) => {
    if (!url) return;
    const n = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(n).catch(() => {});
  };

  const photos = useMemo(() => {
    const all: { url: string; spot_id: string }[] = [];
    spots.forEach((s: any) => {
      (s.images || []).forEach((img: any) => {
        if (img.image_url) all.push({ url: img.image_url, spot_id: s.spot_id });
      });
    });
    return all;
  }, [spots]);

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const isSelf = me?.user_id === profile.user_id;
  const isFollowing = !!profile.is_following;
  const stats = profile.stats || {};
  const banner = profile.banner_image_url;
  const avatar = profile.avatar_image_url || profile.avatar_url;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        {/* Banner */}
        <View style={styles.banner}>
          {banner ? (
            <Image source={{ uri: banner }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          ) : (
            <View style={styles.bannerFallback} />
          )}
          <View style={styles.bannerOverlay} />
          {/* Back + share */}
          <View style={styles.bannerTopLeft}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtnDark} testID="user-back">
              <ChevronLeft size={20} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
          <View style={styles.bannerTopRight}>
            <TouchableOpacity onPress={shareProfile} style={styles.iconBtnDark} testID="user-share">
              <Share2 size={16} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Avatar */}
        <View style={styles.avatarWrap}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{profile.name?.[0]?.toUpperCase() || '?'}</Text>
            </View>
          )}
        </View>

        {/* Identity */}
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{profile.name}</Text>
            {profile.verification_status === 'verified' && (
              <View style={styles.verifiedDot} testID="user-verified">
                <ShieldCheck size={14} color={colors.textInverse} />
              </View>
            )}
          </View>
          <Text style={styles.handle}>@{profile.username}</Text>
          {(profile.city || profile.state) && (
            <View style={styles.locRow}>
              <MapPin size={12} color={colors.textTertiary} />
              <Text style={styles.locTxt}>
                {[profile.city, profile.state].filter(Boolean).join(', ')}
                {profile.primary_country && profile.primary_country !== 'US' ? ` · ${profile.primary_country}` : ''}
              </Text>
            </View>
          )}

          {/* Specialties */}
          {!!(profile.specialties || []).length && (
            <View style={styles.specs}>
              {profile.specialties.slice(0, 4).map((s: string) => (
                <View key={s} style={styles.specPill}>
                  <Text style={styles.specTxt}>{s}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Availability badges */}
          {(profile.booking_available || profile.available_for_second_shooter || profile.mentorship_available) && (
            <View style={styles.availRow}>
              {profile.booking_available && (
                <View style={[styles.availBadge, { backgroundColor: 'rgba(46,204,113,0.15)', borderColor: colors.success }]}>
                  <Briefcase size={11} color={colors.success} />
                  <Text style={[styles.availTxt, { color: colors.success }]}>Booking</Text>
                </View>
              )}
              {profile.available_for_second_shooter && (
                <View style={[styles.availBadge, { backgroundColor: 'rgba(52,152,219,0.15)', borderColor: colors.info }]}>
                  <Handshake size={11} color={colors.info} />
                  <Text style={[styles.availTxt, { color: colors.info }]}>2nd shooter</Text>
                </View>
              )}
              {profile.mentorship_available && (
                <View style={[styles.availBadge, { backgroundColor: 'rgba(245,166,35,0.18)', borderColor: colors.primary }]}>
                  <GraduationCap size={11} color={colors.primary} />
                  <Text style={[styles.availTxt, { color: colors.primary }]}>Mentor</Text>
                </View>
              )}
            </View>
          )}

          {/* Socials */}
          {(profile.website || profile.instagram || profile.facebook_url || profile.tiktok_url) && (
            <View style={styles.linkRow}>
              {!!profile.website && (
                <TouchableOpacity onPress={() => openUrl(profile.website)} style={styles.linkBtn}>
                  <Globe size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {!!profile.instagram && (
                <TouchableOpacity onPress={() => openUrl(`https://instagram.com/${String(profile.instagram).replace('@', '')}`)} style={styles.linkBtn}>
                  <Instagram size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {!!profile.facebook_url && (
                <TouchableOpacity onPress={() => openUrl(profile.facebook_url)} style={styles.linkBtn}>
                  <Facebook size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              {!!profile.tiktok_url && (
                <TouchableOpacity onPress={() => openUrl(profile.tiktok_url)} style={styles.linkBtn}>
                  <Music2 size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* CTA row */}
          {!isSelf && (
            <View style={styles.ctaRow}>
              <Button
                title={isFollowing ? 'Following' : 'Follow'}
                variant={isFollowing ? 'secondary' : 'primary'}
                onPress={toggleFollow}
                loading={busy}
                icon={isFollowing ? <UserMinus size={14} color={colors.text} /> : <UserPlus size={14} color={colors.textInverse} />}
                style={{ flex: 1 }}
                testID="user-follow"
              />
              <Button
                title="Message"
                variant="secondary"
                onPress={messageUser}
                icon={<MessageCircle size={14} color={colors.text} />}
                style={{ flex: 1 }}
                testID="user-message"
              />
            </View>
          )}
          {isSelf && (
            <View style={styles.selfNotice}>
              <Text style={styles.selfNoticeTxt}>This is how your profile appears to other photographers.</Text>
              <Button title="Edit your profile" variant="secondary" onPress={() => router.push('/(tabs)/profile')} />
            </View>
          )}
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatCell label="Followers" value={stats.followers ?? 0} />
          <StatCell label="Following" value={stats.following ?? 0} />
          <StatCell label="Spots"     value={stats.spots_created ?? stats.spots ?? spots.length} />
          <StatCell label="Posts"     value={stats.posts_count ?? posts.length} />
        </View>

        {/* Tabs */}
        <View style={styles.tabStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabStripScroll}
            contentContainerStyle={{ gap: 18, paddingHorizontal: space.xl, alignItems: 'center' }}
          >
            {TABS.map((t) => (
              <TouchableOpacity key={t.key} onPress={() => setActiveTab(t.key)} style={styles.tabBtn} testID={`user-tab-${t.key}`}>
                <Text style={[styles.tabTxt, activeTab === t.key && styles.tabTxtActive]}>{t.label}</Text>
                {activeTab === t.key && <View style={styles.tabUnderline} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Tab content */}
        <View style={{ paddingHorizontal: space.xl, gap: space.md, marginTop: space.md }}>
          {activeTab === 'posts' && (
            posts.length === 0
              ? <EmptyState title="No community posts yet" subtitle={`${profile.name} hasn't posted in Community yet.`} icon={<MessageCircle size={26} color={colors.textSecondary} />} />
              : posts.map((p: any) => (
                  <TouchableOpacity key={p.post_id} style={styles.postCard} onPress={() => router.push(`/community/post/${p.post_id}`)}>
                    <Text style={styles.postCategory}>{(p.category || 'post').toUpperCase()}</Text>
                    <Text style={styles.postTitle}>{p.title || p.body?.slice(0, 80)}</Text>
                    {!!p.body && <Text style={styles.postBody} numberOfLines={3}>{p.body}</Text>}
                    <Text style={styles.postMeta}>{(p.like_count || 0)} likes · {(p.comment_count || 0)} comments</Text>
                  </TouchableOpacity>
                ))
          )}

          {activeTab === 'spots' && (
            spots.length === 0
              ? <EmptyState title="No public spots yet" subtitle={`${profile.name} hasn't shared any spots yet.`} icon={<MapPin size={26} color={colors.textSecondary} />} />
              : spots.slice(0, 30).map((s) => <SpotCard key={s.spot_id} spot={s} width={undefined as any} />)
          )}

          {activeTab === 'photos' && (
            photos.length === 0
              ? <EmptyState title="No photos yet" subtitle="Photos this photographer uploads to their spots will show up here." icon={<ShieldCheck size={26} color={colors.textSecondary} />} />
              : (
                <View style={styles.photoGrid}>
                  {photos.slice(0, 30).map((p, idx) => (
                    <TouchableOpacity key={`${p.spot_id}-${idx}`} onPress={() => router.push(`/spot/${p.spot_id}`)} style={styles.photoTile}>
                      <Image source={{ uri: p.url }} style={StyleSheet.absoluteFillObject} />
                    </TouchableOpacity>
                  ))}
                </View>
              )
          )}

          {activeTab === 'reviews' && (
            <EmptyState
              title={`${stats.reviews_received ?? 0} review${stats.reviews_received === 1 ? '' : 's'} received`}
              subtitle="Full review feed coming soon."
              icon={<ShieldCheck size={26} color={colors.textSecondary} />}
            />
          )}

          {activeTab === 'about' && (
            <View style={styles.aboutCard}>
              {!!profile.bio && <AboutRow label="Bio" value={profile.bio} />}
              {!!profile.years_experience && <AboutRow label="Years shooting" value={String(profile.years_experience)} />}
              {!!profile.service_radius_miles && <AboutRow label="Service radius" value={`${profile.service_radius_miles} mi`} />}
              {!!profile.primary_country && <AboutRow label="Country" value={profile.primary_country} />}
              {!!profile.timezone && <AboutRow label="Timezone" value={profile.timezone} />}
              <AboutRow label="Joined" value={profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'} />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.aboutRow}>
      <Text style={styles.aboutLabel}>{label}</Text>
      <Text style={styles.aboutVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },

  banner: { height: 160, backgroundColor: colors.surface1, position: 'relative', overflow: 'hidden' },
  bannerFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface1 },
  bannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  bannerTopLeft: { position: 'absolute', top: space.md, left: space.xl },
  bannerTopRight: { position: 'absolute', top: space.md, right: space.xl, flexDirection: 'row', gap: 8 },
  iconBtnDark: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },

  avatarWrap: { alignItems: 'center', marginTop: -44 },
  avatar: {
    width: 104, height: 104, borderRadius: 52,
    borderWidth: 4, borderColor: colors.bg, backgroundColor: colors.surface2,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.text, fontFamily: font.display, fontSize: 36 },

  headerText: { paddingHorizontal: space.xl, paddingTop: space.md, alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  name: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.3, textAlign: 'center' },
  verifiedDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.info,
    alignItems: 'center', justifyContent: 'center',
  },
  handle: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13, marginTop: 2 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  locTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 12 },

  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md, justifyContent: 'center' },
  specPill: {
    backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radii.pill, borderColor: colors.border, borderWidth: 1,
  },
  specTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },

  availRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm, justifyContent: 'center' },
  availBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, borderWidth: 1,
  },
  availTxt: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.3 },

  linkRow: { flexDirection: 'row', gap: 8, marginTop: space.md, justifyContent: 'center' },
  linkBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },

  ctaRow: { flexDirection: 'row', gap: 8, marginTop: space.lg, width: '100%' },
  selfNotice: { marginTop: space.lg, gap: 8, alignItems: 'stretch', width: '100%' },
  selfNoticeTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, textAlign: 'center' },

  statsRow: {
    flexDirection: 'row', marginTop: space.lg, paddingHorizontal: space.xl, gap: 8,
  },
  statCell: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    backgroundColor: colors.surface1, borderRadius: radii.md, borderColor: colors.border, borderWidth: 1,
  },
  statVal: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  statLbl: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 2 },

  tabStrip: { marginTop: space.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabStripScroll: { flexGrow: 0, flexShrink: 0, maxHeight: 44 },
  tabBtn: { paddingVertical: 12 },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 0.2 },
  tabTxtActive: { color: colors.text },
  tabUnderline: {
    height: 2, backgroundColor: colors.primary, marginTop: 8, marginHorizontal: -2, borderRadius: 2,
  },

  postCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, padding: space.md, gap: 6,
  },
  postCategory: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  postTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  postBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  postMeta: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 4 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginHorizontal: -space.xl / 2 },
  photoTile: {
    width: '32%', aspectRatio: 1, backgroundColor: colors.surface2, borderRadius: radii.sm, overflow: 'hidden',
  },

  aboutCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, padding: space.lg, gap: space.sm,
  },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  aboutLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  aboutVal: { color: colors.text, fontFamily: font.body, fontSize: 13, flexShrink: 1, textAlign: 'right' },

  empty: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', paddingVertical: space.xxl },
});
