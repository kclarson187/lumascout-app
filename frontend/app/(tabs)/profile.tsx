import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  Share,
  Switch,
  Platform,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  LogOut,
  Settings,
  BarChart3,
  Crown,
  Edit3,
  Store,
  Camera,
  Share2,
  Globe2,
  AtSign,
  Music2,
  ShieldCheck,
  Briefcase,
  Users as UsersIcon,
  MapPin,
  Handshake,
  GraduationCap,
  MessageCircle,
  HelpCircle,
  Eye,
  Inbox as InboxIcon,
  Globe as GlobeIcon2,
  MapPin as MapPinIcon,
  MessageSquare as MessageSquareIcon } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GlobeIcon from '../../src/components/icons/GlobeIcon';
import { useAuth } from '../../src/auth';
import { api, formatApiError } from '../../src/api';
import { primeAndRequestMediaLibrary } from '../../src/lib/permissions';
import { colors, font, space, radii, SHOOT_TYPES } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input, Chip, EmptyState } from '../../src/components/ui';
import SpotCard from '../../src/components/SpotCard';
import VerifiedBadge from '../../src/components/VerifiedBadge';
import UserBadge from '../../src/components/UserBadge';
import PremiumProfileExtras from '../../src/components/PremiumProfileExtras';
import { ZeroAwareStatRow } from '../../src/components/ZeroAwareStatRow';
import { ProfileOnboardingCard } from '../../src/components/ProfileOnboardingCard';
// Jun 2025 — Profile portfolio redesign
import PortfolioGrid from '../../src/components/PortfolioGrid';
import ScoutedMiniMap from '../../src/components/ScoutedMiniMap';
import AchievementsSection from '../../src/components/AchievementsSection';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';

// AsyncStorage key — sticky "user has tapped Share Profile at least
// once" flag. Used to mark the 4th onboarding step (Share Profile)
// as complete since we don't track share events server-side yet.
const PROFILE_SHARED_FLAG = 'lumascout_profile_shared_v1';


type TabKey = 'overview' | 'portfolio' | 'services' | 'scouted';
// Jun 2025 — Profile tabs restructured into 4 clear photographer-
// portfolio sections per redesign CR. Old tab keys (posts, photos,
// reviews) are folded into Overview so we don't lose the underlying
// content (it just gets a cleaner home).
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'services',  label: 'Services' },
  { key: 'scouted',   label: 'Scouted Spots' },
];

const emptyForm = {
  name: '',
  bio: '',
  city: '',
  state: '',
  instagram: '',
  website: '',
  facebook_url: '',
  tiktok_url: '',
  years_experience: '',
  service_radius_miles: '',
  booking_available: false,
  available_for_second_shooter: false,
  mentorship_available: false,
  primary_country: 'US',
  specialties: [] as string[] };

import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';

export default function Profile() {
  return (
    <ScreenErrorBoundary label="Profile">
      <ProfileImpl />
    </ScreenErrorBoundary>
  );
}

function ProfileImpl() {
  const { user, logout, updateProfile, refresh } = useAuth();
  const kbHeight = useKeyboardHeight();
  const [mySpots, setMySpots] = useState<any[]>([]);
  const [myPosts, setMyPosts] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [reviewsReceived, setReviewsReceived] = useState<any[]>([]);
  // Jun 2025 — Portfolio tab data. Lazy-loaded when the user first
  // switches to the Portfolio tab so we don't pay the cost on every
  // profile open.
  const [portfolioPhotos, setPortfolioPhotos] = useState<any[]>([]);
  const [portfolioLoaded, setPortfolioLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [editMode, setEditMode] = useState(false);
  // PRD: Portfolio empty-state sheet — surfaces when the Portfolio CTA is
  // tapped but the user has no website set. Offers a single action ("Add
  // Portfolio Link") which drops them into edit mode so they can fill it.
  const [portfolioEmptyOpen, setPortfolioEmptyOpen] = useState(false);
  const [uploading, setUploading] = useState<'banner' | 'avatar' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [refreshing, setRefreshing] = useState(false);
  // Sticky "user has tapped Share Profile at least once" flag — used to
  // mark the 4th onboarding step as complete since we don't track share
  // events server-side. Re-hydrated on mount, persisted via AsyncStorage.
  const [hasSharedProfile, setHasSharedProfile] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(PROFILE_SHARED_FLAG)
      .then((v) => { if (v === '1') setHasSharedProfile(true); })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [spotsRes, postsRes, collRes, reviewsRes] = await Promise.all([
        api.get('/me/spots').catch(() => []),
        api.get('/posts', { author_id: user.user_id, limit: 20 }).catch(() => ({ items: [] })),
        api.get('/me/collections').catch(() => []),
        api.get('/me/reviews-received').catch(() => ({ items: [] })),
      ]);
      setMySpots(Array.isArray(spotsRes) ? spotsRes : spotsRes?.items || []);
      setMyPosts(postsRes?.items || []);
      setCollections(Array.isArray(collRes) ? collRes : collRes?.items || []);
      setReviewsReceived(reviewsRes?.items || []);
    } catch {}
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Pull-to-refresh — re-fetches profile lists + refreshes auth/me so
  // stats, plan, usage stay live. Profile lists are `set*` (not push),
  // so items can never duplicate after a refresh.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refresh()]);
    } catch {} finally {
      setRefreshing(false);
    }
  }, [load, refresh]);

  useEffect(() => {
    if (user && !editMode) {
      setForm({
        name: user.name || '',
        bio: user.bio || '',
        city: user.city || '',
        state: user.state || '',
        instagram: user.instagram || '',
        website: user.website || '',
        facebook_url: user.facebook_url || '',
        tiktok_url: user.tiktok_url || '',
        years_experience: String(user.years_experience ?? ''),
        service_radius_miles: String(user.service_radius_miles ?? ''),
        booking_available: !!user.booking_available,
        available_for_second_shooter: !!user.available_for_second_shooter,
        mentorship_available: !!user.mentorship_available,
        primary_country: user.primary_country || 'US',
        specialties: user.specialties || [] });
    }
  }, [user, editMode]);

  // Jun 2025 — Portfolio tab lazy load. Hits the new
  // /api/me/portfolio-photos endpoint which combines spot uploads and
  // community uploads (deduped server-side). We fire it the first
  // time the user actually opens the Portfolio tab so a profile
  // open doesn't pay the cost.
  useEffect(() => {
    if (activeTab !== 'portfolio' || portfolioLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/me/portfolio-photos?limit=120');
        if (cancelled) return;
        setPortfolioPhotos(Array.isArray(res?.items) ? res.items : []);
      } catch {
        if (!cancelled) setPortfolioPhotos([]);
      } finally {
        if (!cancelled) setPortfolioLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, portfolioLoaded]);

  const photos = useMemo(() => {
    const all: { url: string; spot_id: string }[] = [];
    mySpots.forEach((s: any) => {
      (s.images || []).forEach((img: any) => {
        if (img.image_url) all.push({ url: img.image_url, spot_id: s.spot_id });
      });
    });
    return all;
  }, [mySpots]);

  if (!user) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <Text style={styles.loadingTitle}>Sign in</Text>
        <Button title="Sign in" onPress={() => router.push('/(auth)/login')} />
      </SafeAreaView>
    );
  }

  const staffRoles = ['admin', 'super_admin', 'moderator', 'support'];
  const isStaff = staffRoles.includes(user.role || '');

  const saveProfile = async () => {
    const body: any = {
      name: form.name,
      bio: form.bio,
      city: form.city,
      state: form.state,
      instagram: form.instagram,
      website: form.website,
      facebook_url: form.facebook_url,
      tiktok_url: form.tiktok_url,
      booking_available: form.booking_available,
      available_for_second_shooter: form.available_for_second_shooter,
      mentorship_available: form.mentorship_available,
      primary_country: form.primary_country,
      specialties: form.specialties };
    const years = parseInt(form.years_experience, 10);
    const radius = parseInt(form.service_radius_miles, 10);
    if (!Number.isNaN(years)) body.years_experience = years;
    if (!Number.isNaN(radius)) body.service_radius_miles = radius;
    try {
      await updateProfile(body);
      setEditMode(false);
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    }
  };

  const toggleSpecialty = (s: string) => {
    setForm((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(s)
        ? prev.specialties.filter((x) => x !== s)
        : [...prev.specialties, s] }));
  };

  const pickAndUpload = async (kind: 'banner' | 'avatar') => {
    const granted = await primeAndRequestMediaLibrary();
    if (!granted) {
      // The prime sheet already showed the "why" + offered Settings
      // when blocked. Exit gracefully — the user can still edit the
      // rest of their profile.
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      base64: false,
      allowsEditing: true,
      aspect: kind === 'banner' ? [3, 1] : [1, 1] });
    if (res.canceled) return;
    const asset = res.assets[0];
    setUploading(kind);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: kind === 'banner' ? 1400 : 600 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) {
        Alert.alert('Could not process image');
        return;
      }
      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      await updateProfile(
        kind === 'banner'
          ? { banner_image_url: dataUrl }
          : { avatar_image_url: dataUrl, avatar_url: dataUrl },
      );
    } catch (e) {
      Alert.alert('Upload failed', formatApiError(e));
    } finally {
      setUploading(null);
    }
  };

  const openUrl = (url?: string) => {
    if (!url) return;
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(normalized).catch(() => {});
  };

  const shareProfile = async () => {
    // CR Item 8 (May 2026) — was previously calling Share.share with
    // ONLY a `message` field and no URL → recipients got just a string
    // with no link. Now wired through the unified shareProfile helper
    // which calls /api/share/user/{id} (returns Open Graph metadata
    // + UA-driven App Store / Play Store / web fallback). Recipients
    // see a proper link card preview in iMessage / SMS / Slack /
    // Twitter and a tappable URL that lands on the right destination.
    try {
      const { shareProfile: shareProfileSmart } = await import('../../src/utils/share');
      await shareProfileSmart({
        user_id: user.user_id || user.id,
        display_name: user.name || user.display_name,
        username: user.username,
        specialty: user.specialty || user.photographer_specialty });
      // Mark the onboarding "Share Profile" step complete.
      setHasSharedProfile(true);
      AsyncStorage.setItem(PROFILE_SHARED_FLAG, '1').catch(() => {});
    } catch {}
  };

  const banner = user.banner_image_url;
  const avatar = user.avatar_image_url || user.avatar_url;
  const stats = user.stats || {};

  const plan = (user.plan || 'free') as string;
  const isComp = plan.startsWith('comp_') || plan.startsWith('trial_');
  const planLabel =
    plan === 'free' ? 'Free' : plan.replace('comp_', 'Comp · ').replace('trial_', 'Trial · ').toUpperCase();

  // FIX(pre-launch cleanup #4): Membership-tier helpers used to drive the
  // upgrade card. Single source of truth instead of strict `plan === 'free'`
  // string compare which mishandled comp_/trial_ tiers and never surfaced
  // an "Upgrade to Elite" CTA for paying Pro users.
  //   • FREE         → show 'Go Pro / Go Elite'
  //   • PRO          → show 'Upgrade to Elite'
  //   • ELITE        → hide all upgrade CTAs (already at top)
  // Staff roles are decoupled — admins/super_admins on Free still see CTA.
  const isElitePlan = plan === 'elite' || plan === 'comp_elite' || plan === 'trial_elite';
  const isProPlan = (plan === 'pro' || plan === 'comp_pro' || plan === 'trial_pro') && !isElitePlan;
  const isFreePlan = !isElitePlan && !isProPlan;

  // PRD priority #6: gate role-based tools by plan + staff flag so we don't
  // advertise features the user can't actually use.
  const hasCreatorTools = plan !== 'free'; // Pro / Elite / comp_* / trial_*
  const hasAdminTools = isStaff;
  // FIX(Commit 7c / 2026-04): Profile is a consumer surface first, a tools
  // surface second. Admin Dashboard was relocated to Settings > Staff Tools
  // so it no longer dominates the main scroll with an amber card. The
  // Creator Dashboard / Pack Marketplace tiles stay here — they're Elite-tier
  // monetization surfaces for end users, not staff tooling.
  const showRoleSection = hasCreatorTools;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: 60 + (Platform.OS === 'android' ? kbHeight : 0) }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* Apr 2026 — Premium kicker header. "PROFILE / Your creator hub"
              + Share + Settings icons sits ABOVE the banner so the page
              opens with a clear identity statement instead of jumping
              straight into the cover photo. */}
          <View style={styles.kickerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kickerLabel}>PROFILE</Text>
              <Text style={styles.kickerTitle}>Your creator hub</Text>
            </View>
            <TouchableOpacity
              style={styles.kickerIconBtn}
              onPress={shareProfile}
              testID="profile-kicker-share"
              hitSlop={8}
            >
              <Share2 size={16} color={colors.text} />
            </TouchableOpacity>
            {/* May 2026 — PRD: "View as Public" / 3rd-person preview
                of the user's own profile. Routes to /user/[id] with a
                `preview=1` query param so the UserProfile screen hides
                owner-only controls and shows a "PREVIEWING YOUR PUBLIC
                PROFILE" ribbon. Gracefully a no-op when user is
                missing (still loading). */}
            <TouchableOpacity
              style={styles.kickerIconBtn}
              onPress={() => {
                if (!user?.user_id) return;
                router.push({ pathname: '/user/[id]', params: { id: user.user_id, preview: '1' } } as any);
              }}
              testID="profile-kicker-preview"
              hitSlop={8}
              accessibilityLabel="Preview public profile"
            >
              <Eye size={16} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.kickerIconBtn}
              onPress={() => router.push('/settings')}
              testID="profile-kicker-settings"
              hitSlop={8}
            >
              <Settings size={16} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Jun 2025 refresh — 3-step creator profile setup card.
              Auto-hides once profile image, cover image and bio are
              all set so the profile returns to clean content. */}
          <ProfileOnboardingCard
            hasProfileImage={!!(user.avatar_image_url || user.avatar_url)}
            hasCoverImage={!!user.banner_image_url}
            hasBio={(user.bio || '').trim().length >= 12}
            onAddProfileImage={() => pickAndUpload('avatar')}
            onAddCoverImage={() => pickAndUpload('banner')}
            onWriteBio={() => setEditMode(true)}
          />

          {/* Banner */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => pickAndUpload('banner')}
            style={styles.banner}
            testID="profile-banner"
          >
            {banner ? (
              <Image source={{ uri: banner }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            ) : (
              <View style={styles.bannerFallback} />
            )}
            <View style={styles.bannerOverlay} />
            {/* Jun 2025 — bottom-anchored legibility gradient. Keeps the
                top of the cover crisp while ensuring name/handle/
                member-since text below the banner reads cleanly even on
                bright covers. */}
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.0)', 'rgba(20,20,20,0.55)', 'rgba(20,20,20,0.85)']}
              locations={[0, 0.45, 0.78, 1]}
              style={StyleSheet.absoluteFillObject as any}
              pointerEvents="none"
            />
            <View style={styles.bannerEdit}>
              <Camera size={14} color={colors.textInverse} />
              <Text style={styles.bannerEditTxt}>
                {uploading === 'banner' ? 'Uploading…' : banner ? 'Change cover' : 'Add cover photo'}
              </Text>
            </View>
            {/* Apr 2026 cleanup: removed duplicate Share + Settings
                icons that floated over the cover photo — both actions
                now live exclusively in the kicker header at the top
                of the screen. */}
          </TouchableOpacity>

          {/* Avatar overlapping banner */}
          <View style={styles.avatarWrap}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => pickAndUpload('avatar')} testID="profile-avatar">
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                  <Camera size={22} color={colors.textSecondary} />
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                {uploading === 'avatar'
                  ? <ActivityIndicator size="small" color={colors.textInverse} />
                  : <Camera size={12} color={colors.textInverse} />}
              </View>
            </TouchableOpacity>
          </View>

          {/* Name + handle + primary actions
              Jun 2025 — verified shield and UserBadge moved OUT of the
              header into the dedicated Achievements section lower on
              the page to reduce header clutter. The header now reads
              as a clean editorial-magazine masthead. */}
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={1}>{user.name}</Text>
            <Text style={styles.handle}>@{user.username}</Text>
            {(user.city || user.state) && (
              <View style={styles.locRow}>
                <MapPin size={12} color={colors.textTertiary} />
                <Text style={styles.locTxt}>
                  {[user.city, user.state].filter(Boolean).join(', ')}
                  {user.primary_country && user.primary_country !== 'US'
                    ? ` · ${user.primary_country}`
                    : ''}
                </Text>
              </View>
            )}
            {/* Jun 2025 — "Member since YYYY". Read from `user.created_at`.
                Falls back gracefully when the field is missing. */}
            {(() => {
              try {
                const iso = user.created_at || user.joined_at;
                if (!iso) return null;
                const yr = new Date(iso).getUTCFullYear();
                if (!Number.isFinite(yr) || yr < 2000) return null;
                return (
                  <Text style={styles.memberSince} testID="profile-member-since">Member since {yr}</Text>
                );
              } catch { return null; }
            })()}
            {!!(user.specialties || []).length && (
              <View style={styles.specs}>
                {user.specialties.slice(0, 4).map((s: string) => (
                  <View key={s} style={styles.specPill}>
                    <Text style={styles.specTxt}>{s}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Availability badges */}
            <View style={styles.availRow}>
              {user.booking_available && (
                <View style={[styles.availBadge, { backgroundColor: 'rgba(46,204,113,0.15)', borderColor: colors.success }]}>
                  <Briefcase size={11} color={colors.success} />
                  <Text style={[styles.availTxt, { color: colors.success }]}>Booking</Text>
                </View>
              )}
              {user.available_for_second_shooter && (
                <View style={[styles.availBadge, { backgroundColor: 'rgba(52,152,219,0.15)', borderColor: colors.info }]}>
                  <Handshake size={11} color={colors.info} />
                  <Text style={[styles.availTxt, { color: colors.info }]}>2nd shooter</Text>
                </View>
              )}
              {user.mentorship_available && (
                <View style={[styles.availBadge, { backgroundColor: 'rgba(245,166,35,0.18)', borderColor: colors.primary }]}>
                  <GraduationCap size={11} color={colors.primary} />
                  <Text style={[styles.availTxt, { color: colors.primary }]}>Mentor</Text>
                </View>
              )}
            </View>

            {/* Secondary socials — Portfolio is now promoted to the primary
                CTA row below alongside Share profile. */}
            {(user.instagram || user.facebook_url || user.tiktok_url) && (
              <View style={styles.linkRow}>
                {!!user.instagram && (
                  <TouchableOpacity onPress={() => openUrl(`https://instagram.com/${user.instagram.replace('@', '')}`)} style={styles.linkBtn}>
                    <AtSign size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
                {!!user.facebook_url && (
                  <TouchableOpacity onPress={() => openUrl(user.facebook_url)} style={styles.linkBtn}>
                    <Globe2 size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
                {!!user.tiktok_url && (
                  <TouchableOpacity onPress={() => openUrl(user.tiktok_url)} style={styles.linkBtn}>
                    <Music2 size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* June 2025 redesign — single CTA row: Edit Profile + Share Profile.
                Portfolio button moved into the Quick Actions section below to
                keep this primary row to just two headline actions. */}
            <View style={[styles.ctaRow, { marginTop: space.md }]}>
              <Button
                title={editMode ? 'Cancel' : 'Edit Profile'}
                variant="secondary"
                onPress={() => setEditMode(!editMode)}
                style={{ flex: 1 }}
                testID="profile-edit-toggle"
              />
              <Button
                title="Share Profile"
                variant="ghost"
                onPress={shareProfile}
                style={{ flex: 1 }}
              />
            </View>
          </View>

          {/* Jun 2025 — Stats row routed through ZeroAwareStatRow.
              Cells with value=0 hide the "0" and show a short,
              encouraging prompt. If ALL stats are zero, the row
              collapses to one "Just getting started" card so the
              profile never reads as an empty grid. */}
          <View style={{ paddingHorizontal: space.xl, marginTop: space.lg }}>
            <ZeroAwareStatRow
              items={[
                {
                  label: 'Followers',
                  value: stats.followers ?? 0,
                  kind: 'followers',
                  onPress: () => router.push(`/user/${user.user_id}/followers` as any),
                  promptOnPress: shareProfile,
                  zeroCopy: 'Share your profile to grow',
                },
                {
                  label: 'Following',
                  value: stats.following ?? 0,
                  kind: 'following',
                  onPress: () => router.push(`/user/${user.user_id}/following` as any),
                  promptOnPress: () => router.push('/(tabs)/explore' as any),
                },
                {
                  label: 'Views',
                  value: stats.profile_views ?? 0,
                  kind: 'views',
                  promptOnPress: shareProfile,
                },
                {
                  label: 'Saves',
                  value: stats.total_spot_saves ?? mySpots.reduce((acc: number, sp: any) => acc + (sp.save_count || 0), 0),
                  kind: 'saves',
                  promptOnPress: () => router.push('/(tabs)/add' as any),
                  zeroCopy: 'Upload spots to earn saves',
                },
              ]}
              allZeroTitle="You're just getting started"
              allZeroSubtitle="Upload a spot and share your profile — your stats appear here as people discover you."
              allZeroCtaLabel="Share"
              allZeroCtaOnPress={shareProfile}
            />
          </View>

          <View style={styles.quickRow}>
            <QuickCell
              icon={<MapPinIcon size={18} color={colors.primary} />}
              label="Upload Spot"
              onPress={() => router.push('/(tabs)/add' as any)}
              testID="profile-quick-upload-spot"
            />
            <QuickCell
              icon={<MessageSquareIcon size={18} color={colors.primary} />}
              label="Create Post"
              onPress={() => router.push('/community/compose' as any)}
              testID="profile-quick-create-post"
            />
            <QuickCell
              icon={<GlobeIcon2 size={18} color={colors.primary} />}
              label="Portfolio"
              onPress={() => {
                if (user.website) openUrl(user.website);
                else setPortfolioEmptyOpen(true);
              }}
              testID="profile-quick-portfolio"
            />
            <QuickCell
              icon={<InboxIcon size={18} color={colors.primary} />}
              label="Messages"
              onPress={() => router.push('/inbox' as any)}
              testID="profile-quick-messages"
            />
          </View>

          {/* June 2025 — PremiumProfileExtras (dense dashboard) removed.
              Stats + Quick Actions are now compact inline blocks above,
              keeping the screen calm and creator-focused. */}

          {/* PRD #4: Badges strip — visual shorthand for who this photographer
              is at a glance. Only shows badges the user has actually earned
              (no placeholder pills). Horizontally scrollable so we can add
              more achievements over time without breaking the layout. */}
          {(() => {
            const badges: { key: string; label: string; color: string; icon: React.ReactNode; bg: string }[] = [];
            if (user.verification_status === 'verified') {
              badges.push({
                key: 'verified', label: 'Verified',
                color: colors.info, bg: 'rgba(96,165,250,0.14)',
                icon: <ShieldCheck size={12} color={colors.info} /> });
            }
            if (plan !== 'free') {
              badges.push({
                key: 'plan', label: planLabel,
                color: colors.primary, bg: 'rgba(245,166,35,0.14)',
                icon: <Crown size={12} color={colors.primary} /> });
            }
            if ((user.years_experience ?? 0) >= 3) {
              badges.push({
                key: 'years', label: `${user.years_experience}+ yrs`,
                color: colors.success, bg: 'rgba(16,185,129,0.14)',
                icon: <GraduationCap size={12} color={colors.success} /> });
            }
            if ((stats.spots_created ?? mySpots.length) >= 1) {
              badges.push({
                key: 'contrib', label: 'Contributor',
                color: colors.text, bg: colors.surface2,
                icon: <MapPin size={12} color={colors.text} /> });
            }
            if ((stats.spots_created ?? mySpots.length) >= 10) {
              badges.push({
                key: 'scout', label: 'Top Scout',
                color: colors.primary, bg: 'rgba(245,166,35,0.14)',
                icon: <Store size={12} color={colors.primary} /> });
            }
            if (badges.length === 0) return null;
            return (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.badgesStrip}
              >
                {badges.map((b) => (
                  <View
                    key={b.key}
                    style={[styles.badgePill, { backgroundColor: b.bg, borderColor: b.color + '55' }]}
                  >
                    {b.icon}
                    <Text style={[styles.badgePillTxt, { color: b.color }]} numberOfLines={1}>{b.label}</Text>
                  </View>
                ))}
              </ScrollView>
            );
          })()}

          {/* PRD #4 + pre-launch cleanup #4: Membership upgrade card.
              FREE  → 'Go Pro' (entry-level CTA)
              PRO   → 'Upgrade to Elite' (mid-funnel)
              ELITE → hidden (already at top tier; staff role is separate). */}
          {!isElitePlan && (
            <TouchableOpacity
              style={styles.upgradeCard}
              onPress={() => router.push('/paywall')}
              testID="profile-upgrade-cta"
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={['rgba(245,166,35,0.16)', 'rgba(245,166,35,0.04)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.upgradeCrown}>
                <Crown size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.upgradeTitle}>
                  {isProPlan ? 'Unlock the Elite tier.' : 'Scout smarter. Shoot better.'}
                </Text>
                <Text style={styles.upgradeBody}>
                  {isProPlan
                    ? 'Priority placement, advanced analytics, AI co-pilot, and the gold Elite badge.'
                    : 'Unlimited saves, AI shot lists, creator analytics, verified badge — starting at $8/mo.'}
                </Text>
              </View>
              <View style={styles.upgradeArrow}>
                <Text style={styles.upgradeArrowTxt}>{isProPlan ? 'Go Elite →' : 'Go Pro →'}</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* June 2025 — Share-the-app big card removed per redesign CR
              ("only ONE subtle upgrade card"). Sharing is still
              available via the "Share Profile" button at the top. */}

          {/* === ROLE-BASED TOOLS ======================================== */}
          {showRoleSection && (
            <>
              <Text style={styles.sectionLabel}>My tools</Text>
              <View style={styles.actionsRow}>
                {hasCreatorTools && (
                  <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/creator-dashboard')} testID="profile-dashboard">
                    <BarChart3 size={18} color={colors.primary} />
                    <Text style={styles.actionTxt}>Creator{'\n'}Dashboard</Text>
                  </TouchableOpacity>
                )}
                {hasCreatorTools && (
                  <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/marketplace')} testID="profile-marketplace">
                    <Store size={18} color={colors.primary} />
                    <Text style={styles.actionTxt}>Marketplace</Text>
                  </TouchableOpacity>
                )}
                {/* FIX(Commit 7c): Admin Dashboard card removed from profile.
                    Relocated to Settings > Staff Tools (only visible to admin /
                    super_admin / moderator). Profile now reads as a consumer
                    surface first. */}
              </View>
            </>
          )}

          {/* === ACCOUNT ================================================= */}
          <Text style={styles.sectionLabel}>Account</Text>
          <ProfileViewersTeaser />
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.actionCard} onPress={() => router.push(plan !== 'free' ? '/billing' : '/paywall')} testID="profile-paywall">
              <Crown size={18} color={colors.primary} />
              <Text style={styles.actionTxt}>
                {plan !== 'free' ? `${planLabel}` : 'Upgrade'}{'\n'}
                {plan !== 'free' ? 'Manage billing' : 'to Pro'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/settings')} testID="profile-settings-card">
              <Settings size={18} color={colors.text} />
              <Text style={styles.actionTxt}>App{'\n'}Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/support')} testID="profile-support">
              <HelpCircle size={18} color={colors.text} />
              <Text style={styles.actionTxt}>Help &{'\n'}Support</Text>
            </TouchableOpacity>
          </View>

          {/* === SUPPORT ================================================= */}

          {/* Sign-out is visually de-emphasised (separate row, subdued) so it
              doesn't sit one tap away from Admin — PRD priority #6. */}
          <TouchableOpacity style={styles.signOutRow} onPress={logout} testID="profile-logout">
            <LogOut size={14} color={colors.secondary} />
            <Text style={styles.signOutTxt}>Sign out</Text>
          </TouchableOpacity>

          {/* Edit form */}
          {editMode && (
            <View style={styles.editCard}>
              <Input label="Name" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} testID="profile-name" />
              <Input label="Bio" value={form.bio} onChangeText={(t) => setForm({ ...form, bio: t })} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 2 }}>
                  <Input label="City" value={form.city} onChangeText={(t) => setForm({ ...form, city: t })} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="State / Province" value={form.state} onChangeText={(t) => setForm({ ...form, state: t })} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Input label="Country" value={form.primary_country} onChangeText={(t) => setForm({ ...form, primary_country: t.toUpperCase().slice(0, 2) })} autoCapitalize="characters" maxLength={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Years in biz" keyboardType="numeric" value={form.years_experience} onChangeText={(t) => setForm({ ...form, years_experience: t.replace(/[^0-9]/g, '') })} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Radius (mi)" keyboardType="numeric" value={form.service_radius_miles} onChangeText={(t) => setForm({ ...form, service_radius_miles: t.replace(/[^0-9]/g, '') })} />
                </View>
              </View>

              <Input label="Portfolio" placeholder="https://yoursite.com" value={form.website} onChangeText={(t) => setForm({ ...form, website: t })} autoCapitalize="none" />
              <Input label="Instagram handle" value={form.instagram} onChangeText={(t) => setForm({ ...form, instagram: t })} autoCapitalize="none" />
              <Input label="Facebook URL" value={form.facebook_url} onChangeText={(t) => setForm({ ...form, facebook_url: t })} autoCapitalize="none" />
              <Input label="TikTok URL" value={form.tiktok_url} onChangeText={(t) => setForm({ ...form, tiktok_url: t })} autoCapitalize="none" />

              <Text style={styles.editLabel}>Availability</Text>
              <ToggleRow label="Accepting bookings" value={form.booking_available} onChange={(v) => setForm({ ...form, booking_available: v })} />
              <ToggleRow label="Available as 2nd shooter" value={form.available_for_second_shooter} onChange={(v) => setForm({ ...form, available_for_second_shooter: v })} />
              <ToggleRow label="Open to mentoring" value={form.mentorship_available} onChange={(v) => setForm({ ...form, mentorship_available: v })} />

              <Text style={styles.editLabel}>Specialties</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {SHOOT_TYPES.map((s) => (
                  <Chip key={s} label={s} active={form.specialties.includes(s)} onPress={() => toggleSpecialty(s)} />
                ))}
              </View>
              <Button title="Save profile" onPress={saveProfile} testID="profile-save" style={{ marginTop: space.md }} />
            </View>
          )}

          {/* Jun 2025 — "Spots I've scouted" mini-map. Pure read-only
              consumption of SafeMapView (the existing stability
              wrapper) — no clustering, no native modifications.
              Wrapped in a defensive error boundary so any native-map
              hiccup falls back to a static info card. Pins are
              pre-filtered to exclude private / location-hidden spots. */}
          <ScoutedMiniMap spots={mySpots as any} />

          {/* Tabs */}
          <View style={styles.tabStrip}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, maxHeight: 44 }} contentContainerStyle={{ gap: 18, paddingHorizontal: space.xl, alignItems: 'center' }}>
              {TABS.map((t) => (
                <TouchableOpacity key={t.key} onPress={() => setActiveTab(t.key)} style={styles.tabBtn} testID={`tab-${t.key}`}>
                  <Text style={[styles.tabTxt, activeTab === t.key && styles.tabTxtActive]}>{t.label}</Text>
                  {activeTab === t.key && <View style={styles.tabUnderline} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Tab content */}
          <View style={{ paddingHorizontal: space.xl, gap: space.md, marginTop: space.md }}>
            {activeTab === 'overview' && (
              myPosts.length === 0
                ? <EmptyState
                    title="Start a conversation"
                    subtitle="Share a recent win, drop a tip, or ask the community for help."
                    icon={<MessageCircle size={28} color={colors.textSecondary} />}
                    action={<Button title="Write a post" onPress={() => router.push('/community/compose')} />}
                  />
                : myPosts.slice(0, 20).map((p: any) => (
                    <TouchableOpacity key={p.post_id} style={styles.postCard} onPress={() => router.push(`/community/post/${p.post_id}`)}>
                      <Text style={styles.postCategory}>{(p.category || 'post').toUpperCase()}</Text>
                      <Text style={styles.postTitle}>{p.title || p.body?.slice(0, 80)}</Text>
                      {!!p.body && <Text style={styles.postBody} numberOfLines={3}>{p.body}</Text>}
                      <Text style={styles.postMeta}>{(p.like_count || 0)} likes · {(p.comment_count || 0)} comments</Text>
                    </TouchableOpacity>
                  ))
            )}

            {activeTab === 'portfolio' && (
              <PortfolioGrid photos={portfolioPhotos} />
            )}

            {activeTab === 'scouted' && (
              mySpots.length === 0
                ? <EmptyState
                    title="No spots yet"
                    subtitle="Scout a great location and add your first spot — it takes less than a minute."
                    icon={<MapPin size={28} color={colors.textSecondary} />}
                    action={<Button title="Add a spot" onPress={() => router.push('/(tabs)/add')} />}
                  />
                : mySpots.slice(0, 20).map((s) => <SpotCard key={s.spot_id} spot={s} width={undefined as any} />)
            )}

            {activeTab === 'photos' && (
              photos.length === 0
                ? <EmptyState
                    title="Photos land here"
                    subtitle="Upload photos to your spots and they'll all show up in one beautiful grid."
                    icon={<Camera size={28} color={colors.textSecondary} />}
                  />
                : (
                  // PRD #4: 3-column pseudo-masonry. We vary aspect ratios
                  // across a 3-tile rhythm (1, 1.35, 0.75) so the grid reads
                  // as a curated portfolio rather than a uniform calendar.
                  <View style={styles.photoGrid}>
                    {photos.slice(0, 30).map((p, idx) => {
                      const ratio = idx % 3 === 1 ? 1.35 : idx % 3 === 2 ? 0.75 : 1;
                      return (
                        <TouchableOpacity
                          key={`${p.spot_id}-${idx}`}
                          onPress={() => router.push(`/spot/${p.spot_id}`)}
                          style={[styles.photoTile, { aspectRatio: 1 / ratio }]}
                        >
                          <Image source={{ uri: p.url }} style={StyleSheet.absoluteFillObject} />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )
            )}

            {activeTab === 'reviews' && (
              reviewsReceived.length === 0
                ? <EmptyState
                    title="No reviews received yet"
                    subtitle="When other photographers visit your spots and leave feedback, their reviews will appear here."
                    icon={<ShieldCheck size={28} color={colors.textSecondary} />}
                  />
                : reviewsReceived.map((r: any, idx: number) => (
                    <View key={r.review_id || `${r.spot_id}-${idx}`} style={styles.postCard}>
                      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                        {r.reviewer?.avatar_url
                          ? <Image source={{ uri: r.reviewer.avatar_url }} style={styles.reviewerAvatar} />
                          : <View style={[styles.reviewerAvatar, { backgroundColor: colors.surface2 }]} />}
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={styles.reviewerName}>{r.reviewer?.name || 'Photographer'}</Text>
                            <VerifiedBadge status={r.reviewer?.verification_status} variant="inline" size={12} />
                          </View>
                          <TouchableOpacity onPress={() => router.push(`/spot/${r.spot_id}`)}>
                            <Text style={styles.reviewSpot} numberOfLines={1}>
                              on {r.spot?.title || 'your spot'}{r.spot?.city ? ` · ${r.spot.city}` : ''}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.starRow}>
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Text key={i} style={{ fontSize: 12, color: i < (r.overall_rating || 0) ? colors.primary : colors.surface3 }}>★</Text>
                          ))}
                        </View>
                      </View>
                      {!!r.review_body && (
                        <Text style={styles.reviewBody} numberOfLines={5}>{r.review_body}</Text>
                      )}
                      <Text style={styles.reviewDate}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</Text>
                    </View>
                  ))
            )}

            {activeTab === 'services' && (
              collections.length === 0
                ? <EmptyState
                    title="Build your first collection"
                    subtitle="Group your favorite spots into curated collections — seasonal picks, bridal locations, or family-friendly."
                    icon={<Store size={28} color={colors.textSecondary} />}
                    action={<Button title="Create a collection" variant="secondary" onPress={() => router.push('/(tabs)/saved')} />}
                  />
                : collections.map((c: any) => (
                    <TouchableOpacity key={c.collection_id} style={styles.postCard} onPress={() => router.push(`/collection/${c.collection_id}`)}>
                      <Text style={styles.postTitle}>{c.title}</Text>
                      <Text style={styles.postMeta}>{(c.spot_ids || []).length} spots</Text>
                    </TouchableOpacity>
                  ))
            )}

            {activeTab === 'about' && (
              <View style={styles.aboutCard}>
                {!!user.bio && <AboutRow label="Bio" value={user.bio} />}
                <AboutRow label="Email" value={user.email} />
                <AboutRow label="Joined" value={user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'} />
                <AboutRow label="Plan" value={planLabel} />
                {user.comp_expiration && (
                  <AboutRow label="Comp expires" value={new Date(user.comp_expiration).toLocaleDateString()} />
                )}
                {!!user.years_experience && (
                  <AboutRow label="Years shooting" value={String(user.years_experience)} />
                )}
                {!!user.service_radius_miles && (
                  <AboutRow label="Service radius" value={`${user.service_radius_miles} mi`} />
                )}
                {!!user.primary_country && (
                  <AboutRow label="Country" value={user.primary_country} />
                )}
                {!!user.timezone && (
                  <AboutRow label="Timezone" value={user.timezone} />
                )}
              </View>
            )}
          </View>

          {/* Jun 2025 — Achievements section. Lives below the tab
              content so the header is uncluttered (badges/UserBadge
              moved out of the name row). Shows Verified, Pro/Elite,
              Founding Scout, Moderator, contributor tiers. Tasteful
              empty state when no achievements have been earned yet. */}
          <AchievementsSection user={user} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* PRD: Portfolio empty-state sheet. Triggered when the Portfolio
          CTA is tapped but no website is configured. Keeps the CTA from
          dead-ending and invites the user to complete their profile. */}
      <Modal
        visible={portfolioEmptyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPortfolioEmptyOpen(false)}
      >
        <Pressable
          style={styles.portfolioEmptyBackdrop}
          onPress={() => setPortfolioEmptyOpen(false)}
        >
          <Pressable style={styles.portfolioEmptySheet} onPress={() => {}}>
            <LinearGradient
              colors={['rgba(245,166,35,0.10)', 'transparent']}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.portfolioEmptyGlyph}>
              <GlobeIcon size={28} active weight="bold" />
            </View>
            <Text style={styles.portfolioEmptyTitle}>No portfolio added yet</Text>
            <Text style={styles.portfolioEmptyBody}>
              Add your website so photographers, clients, and LumaScout viewers
              can discover your published work with one tap.
            </Text>
            <Button
              title="Add Portfolio Link"
              variant="primary"
              onPress={() => {
                setPortfolioEmptyOpen(false);
                setEditMode(true);
              }}
              icon={<GlobeIcon size={15} active weight="regular" />}
              testID="profile-portfolio-empty-cta"
              style={{ alignSelf: 'stretch', marginTop: space.md }}
            />
            <TouchableOpacity
              onPress={() => setPortfolioEmptyOpen(false)}
              style={styles.portfolioEmptyDismiss}
            >
              <Text style={styles.portfolioEmptyDismissTxt}>Not now</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function StatCell({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.statCell} onPress={onPress} activeOpacity={onPress ? 0.7 : 1}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </TouchableOpacity>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surface2, true: colors.primary }}
        thumbColor={colors.textInverse}
      />
    </View>
  );
}

function EmptyStateLegacy({ text }: { text: string }) {
  // kept around only if any caller still references it — unused in the new profile.
  return <Text style={styles.empty}>{text}</Text>;
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.aboutRow}>
      <Text style={styles.aboutLabel}>{label}</Text>
      <Text style={styles.aboutVal}>{value}</Text>
    </View>
  );
}

/**
 * CompactProfileStatCell — June 2025 redesign helper.
 * Compact stats row cell. 1 of 4 inside a single rounded card.
 * Renamed from `StatCell` to avoid collision with the legacy
 * `StatCell` at the bottom of this file used by PremiumProfileExtras.
 */
function CompactProfileStatCell({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const C: any = onPress ? TouchableOpacity : View;
  return (
    <C onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }} activeOpacity={0.85}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </C>
  );
}

/**
 * QuickCell — June 2025 redesign helper.
 * Compact square cards row (Upload Spot / Create Post / Portfolio /
 * Messages). One short row, evenly flexed, no excessive height.
 */
function QuickCell({
  icon, label, onPress, testID }: { icon: React.ReactNode; label: string; onPress: () => void; testID?: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.quickCell} activeOpacity={0.85} testID={testID}>
      <View style={styles.quickIcon}>{icon}</View>
      <Text style={styles.quickLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}



/**
 * ProfileViewersTeaser — Phase B.1 "Who Viewed Your Profile"
 * Premium card above the Account section. Polls /me/viewers/summary
 * and surfaces the 7-day new-viewer count with a one-tap CTA to the
 * full Viewers screen. Deliberately designed to trigger curiosity +
 * repeat opens (free tier sees blurred teaser → upgrade prompt).
 */
function ProfileViewersTeaser() {
  const [summary, setSummary] = useState<{ total_7d: number; total_30d: number; plan: string } | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const s = await api.get('/me/viewers/summary');
      setSummary(s);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { fetchSummary(); }, [fetchSummary]));

  const total7 = summary?.total_7d ?? 0;
  const plan = summary?.plan || 'free';
  const headline = total7 > 0
    ? `${total7} new ${total7 === 1 ? 'viewer' : 'viewers'} this week`
    : 'Who viewed your profile';
  const sub = plan === 'free'
    ? (total7 > 0 ? 'Tap to see who noticed you' : "We'll let you know when someone checks you out")
    : (total7 > 0 ? 'Tap to see the full list' : 'Your viewers will show up here');

  return (
    <TouchableOpacity
      style={viewersStyles.card}
      onPress={() => router.push('/profile-viewers')}
      testID="profile-viewers-teaser"
      activeOpacity={0.85}
    >
      <View style={viewersStyles.iconWrap}>
        <Eye size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={viewersStyles.headline}>{headline}</Text>
        <Text style={viewersStyles.sub}>{sub}</Text>
      </View>
      {plan === 'free' && total7 > 0 ? (
        <View style={viewersStyles.proPill}>
          <Crown size={10} color={colors.primary} />
          <Text style={viewersStyles.proTxt}>Pro</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const viewersStyles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.28)',
    borderRadius: radii.lg,
    marginHorizontal: space.xl, marginBottom: space.md,
    paddingVertical: 14, paddingHorizontal: 14 },
  iconWrap: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center' },
  headline: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  proPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)' },
  proTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10 } });

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Apr 2026 — Premium kicker header above the banner
  kickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    gap: 8 },
  kickerLabel: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10 },
  kickerTitle: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 22,
    marginTop: 2,
    letterSpacing: -0.3 },
  kickerIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border },
  loadingWrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: space.xl },
  loadingTitle: { color: colors.text, fontFamily: font.display, fontSize: 28 },

  banner: {
    // Jun 2025 — full-bleed editorial cover photo. Bumped 160 → 280
    // px tall so the cover reads as a magazine masthead rather than
    // a decorative strip. Avatar overlap math (avatarWrap.marginTop)
    // is unchanged because the avatar's circle still hangs off the
    // bottom edge of the cover.
    height: 280, backgroundColor: colors.surface1, position: 'relative', overflow: 'hidden' },
  bannerFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface1 },
  bannerOverlay: {
    // Replaced flat 25% scrim with a bottom-anchored linear gradient
    // (transparent → 78% black) so name/handle/member-since stay
    // readable over any cover photo (bright bluebonnet field, sunset,
    // urban, snow, etc.) without darkening the whole image.
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)' },
  bannerEdit: {
    // FIX(Commit 7d / 2026-04): 60% black scrim + thin white hairline border
    // for premium frosted-glass look. Previously 55% scrim only — pill got
    // lost over bright covers (bluebonnet/sunset shots). White text guaranteed.
    position: 'absolute', bottom: 48, left: space.xl,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill,
    // iOS-only shadow for lift over bright imagery.
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 } }) },
  bannerEditTxt: { color: '#FFFFFF', fontFamily: font.bodyBold, fontSize: 11 },
  bannerTopRight: {
    position: 'absolute', top: space.md, right: space.xl, flexDirection: 'row', gap: 8 },
  iconBtnDark: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },

  avatarWrap: {
    alignItems: 'center', marginTop: -44 },
  avatar: {
    width: 104, height: 104, borderRadius: 52,
    borderWidth: 4, borderColor: colors.bg, backgroundColor: colors.surface2 },
  avatarEditBadge: {
    // FIX(Commit 7d): bump size 26→28 and add subtle shadow so it reads as
    // tappable over any avatar colour, not just light-skinned ones.
    position: 'absolute', right: 4, bottom: 4, width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.primary, borderColor: colors.bg, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
      android: { elevation: 3 } }) },

  headerText: { paddingHorizontal: space.xl, paddingTop: space.md, alignItems: 'center' },
  name: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.3, textAlign: 'center' },
  verifiedDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.info,
    alignItems: 'center', justifyContent: 'center' },
  handle: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13, marginTop: 2 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  locTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 12 },
  // Jun 2025 — single-line "Member since YYYY" sub-line. Sits between
  // location and specialties for a quiet trust signal.
  memberSince: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 12,
    marginTop: 6,
    letterSpacing: 0.1,
  },

  specs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md, justifyContent: 'center' },
  specPill: {
    backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radii.pill, borderColor: colors.border, borderWidth: 1 },
  specTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 11 },

  availRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm, justifyContent: 'center' },
  availBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, borderWidth: 1 },
  availTxt: { fontFamily: font.bodyBold, fontSize: 10 },

  linkRow: { flexDirection: 'row', gap: 8, marginTop: space.md, justifyContent: 'center' },
  linkBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  // PRD: Portfolio CTA button — full pill with globe icon + "Portfolio"
  // label. Lives in the social link row but visually dominates so it reads
  // as the photographer's hero destination (published work), while the
  // remaining socials stay as compact icon circles.
  // Height matches linkBtn (32px) for baseline alignment across the row.
  portfolioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.55)',
    borderWidth: 1.2 },
  portfolioBtnTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 12.5,
    includeFontPadding: false },
  // PRD: Portfolio empty-state sheet
  portfolioEmptyBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end' },
  portfolioEmptySheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.xxl + space.sm,
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden' },
  portfolioEmptyGlyph: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.42)',
    marginBottom: space.sm },
  portfolioEmptyTitle: {
    color: colors.text, fontFamily: font.display,
    fontSize: 24, letterSpacing: -0.2, textAlign: 'center' },
  portfolioEmptyBody: {
    color: colors.textSecondary, fontFamily: font.body,
    fontSize: 14, lineHeight: 20, textAlign: 'center',
    paddingHorizontal: 8 },
  portfolioEmptyDismiss: { paddingVertical: 10, marginTop: 4 },
  portfolioEmptyDismissTxt: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },

  ctaRow: { flexDirection: 'row', gap: 8, marginTop: space.lg, width: '100%' },

  // ─── June 2025 redesign — compact stats + quick-actions atoms ──
  // One rounded card, 4 evenly-flexed cells, subtle dividers.
  statsCard: {
    flexDirection: 'row',
    marginHorizontal: space.xl,
    marginTop: space.lg,
    paddingVertical: 14,
    paddingHorizontal: 6,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center' },
  statsDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignSelf: 'center' },
  statValue: {
    color: colors.text,
    fontFamily: font.displaySemibold || font.bodyBold,
    fontSize: 18,
    letterSpacing: -0.3,
    marginBottom: 2 },
  statLabel: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 10.5 },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: space.xl,
    marginTop: 12 },
  quickCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)' },
  quickIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.12)' },
  quickLabel: {
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 11.5 },

  statsRow: {
    flexDirection: 'row', marginTop: space.lg, paddingHorizontal: space.xl,
    gap: 8 },
  statCell: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    backgroundColor: colors.surface1, borderRadius: radii.md, borderColor: colors.border, borderWidth: 1 },
  statVal: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  statLbl: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10, marginTop: 2 },

  actionsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: space.xl, marginTop: space.sm },
  actionCard: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    padding: space.md, borderRadius: radii.md, gap: 6, minHeight: 80 },
  adminCard: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12, lineHeight: 16 },
  sectionLabel: {
    color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10, paddingHorizontal: space.xl, marginTop: space.xl, marginBottom: space.xs },
  signOutRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: space.lg, marginHorizontal: space.xl, paddingVertical: 10,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent' },
  signOutTxt: { color: colors.secondary, fontFamily: font.bodyBold, fontSize: 12 },

  editCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    padding: space.lg, borderRadius: radii.lg, gap: space.md, margin: space.xl },
  editLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 4 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6 },
  toggleLabel: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 14, flex: 1 },

  tabStrip: {
    marginTop: space.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn: { paddingVertical: 12 },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 14 },
  tabTxtActive: { color: colors.text },
  tabUnderline: {
    height: 2, backgroundColor: colors.primary, marginTop: 8,
    marginHorizontal: -2, borderRadius: 2 },

  postCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, padding: space.md, gap: 6 },
  postCategory: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10 },
  postTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  postBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  postMeta: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 4 },
  reviewerAvatar: { width: 36, height: 36, borderRadius: 18 },
  reviewerName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  reviewSpot: { color: colors.primary, fontFamily: font.bodyMedium, fontSize: 12, marginTop: 2 },
  starRow: { flexDirection: 'row', gap: 1 },
  reviewBody: { color: colors.text, fontFamily: font.body, fontSize: 13, lineHeight: 19, marginTop: space.sm },
  reviewDate: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 6 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginHorizontal: -space.xl / 2 },
  photoTile: {
    width: '32%', backgroundColor: colors.surface2, borderRadius: radii.sm, overflow: 'hidden' },
  // PRD #4: Badges strip
  badgesStrip: {
    paddingHorizontal: space.xl, paddingVertical: space.sm,
    gap: 6 },
  badgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radii.pill, borderWidth: 1 },
  badgePillTxt: {
    fontFamily: font.bodyBold, fontSize: 11 },
  // PRD #4: Premium Upgrade CTA for Free users
  upgradeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: space.xl, marginTop: space.md,
    paddingHorizontal: space.md, paddingVertical: 14,
    backgroundColor: colors.surface1,
    borderColor: 'rgba(245,166,35,0.35)', borderWidth: 1,
    borderRadius: radii.lg,
    overflow: 'hidden' },
  upgradeCrown: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(245,166,35,0.2)',
    borderColor: 'rgba(245,166,35,0.45)', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center' },
  upgradeTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  upgradeBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  upgradeArrow: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: colors.primary, borderRadius: radii.pill },
  upgradeArrowTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },
  // PRD #11: Share LumaScout row
  shareAppRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: space.xl, marginTop: space.md,
    paddingHorizontal: space.md, paddingVertical: 14,
    backgroundColor: colors.surface1,
    borderColor: 'rgba(245,166,35,0.28)', borderWidth: 1,
    borderRadius: radii.lg,
    overflow: 'hidden' },
  shareAppIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center', justifyContent: 'center' },
  shareAppTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  shareAppBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 2 },

  aboutCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, padding: space.lg, gap: space.sm },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  aboutLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  aboutVal: { color: colors.text, fontFamily: font.body, fontSize: 13, flexShrink: 1, textAlign: 'right' },

  empty: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', paddingVertical: space.xxl } });
