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
} from 'react-native';
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
} from 'lucide-react-native';
import GlobeIcon from '../../src/components/icons/GlobeIcon';
import { useAuth } from '../../src/auth';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii, SHOOT_TYPES } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input, Chip, EmptyState } from '../../src/components/ui';
import SpotCard from '../../src/components/SpotCard';
import VerifiedBadge from '../../src/components/VerifiedBadge';


type TabKey = 'posts' | 'spots' | 'photos' | 'reviews' | 'collections' | 'about';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'posts', label: 'Posts' },
  { key: 'spots', label: 'Spots' },
  { key: 'photos', label: 'Photos' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'collections', label: 'Collections' },
  { key: 'about', label: 'About' },
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
  specialties: [] as string[],
};

export default function Profile() {
  const { user, logout, updateProfile } = useAuth();
  const [mySpots, setMySpots] = useState<any[]>([]);
  const [myPosts, setMyPosts] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [reviewsReceived, setReviewsReceived] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('posts');
  const [editMode, setEditMode] = useState(false);
  const [uploading, setUploading] = useState<'banner' | 'avatar' | null>(null);
  const [form, setForm] = useState(emptyForm);

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
        specialties: user.specialties || [],
      });
    }
  }, [user, editMode]);

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
      specialties: form.specialties,
    };
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
        : [...prev.specialties, s],
    }));
  };

  const pickAndUpload = async (kind: 'banner' | 'avatar') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Media permission required');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      base64: false,
      allowsEditing: true,
      aspect: kind === 'banner' ? [3, 1] : [1, 1],
    });
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
    try {
      await Share.share({
        message: `Check out ${user.name}'s photography profile on LumaScout`,
      });
    } catch {}
  };

  const banner = user.banner_image_url;
  const avatar = user.avatar_image_url || user.avatar_url;
  const stats = user.stats || {};

  const plan = (user.plan || 'free') as string;
  const isComp = plan.startsWith('comp_') || plan.startsWith('trial_');
  const planLabel =
    plan === 'free' ? 'Free' : plan.replace('comp_', 'Comp · ').replace('trial_', 'Trial · ').toUpperCase();

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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
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
            <View style={styles.bannerEdit}>
              <Camera size={14} color={colors.textInverse} />
              <Text style={styles.bannerEditTxt}>
                {uploading === 'banner' ? 'Uploading…' : banner ? 'Change cover' : 'Add cover photo'}
              </Text>
            </View>
            {/* Top-right quick actions */}
            <View style={styles.bannerTopRight}>
              <TouchableOpacity style={styles.iconBtnDark} onPress={shareProfile} testID="profile-share">
                <Share2 size={16} color={colors.textInverse} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtnDark} onPress={() => router.push('/settings')} testID="profile-settings">
                <Settings size={16} color={colors.textInverse} />
              </TouchableOpacity>
            </View>
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

          {/* Name + handle + primary actions */}
          <View style={styles.headerText}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
              <Text style={styles.name} numberOfLines={1}>{user.name}</Text>
              {user.verification_status === 'verified' && (
                <View style={styles.verifiedDot} testID="profile-verified">
                  <ShieldCheck size={14} color={colors.textInverse} />
                </View>
              )}
            </View>
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

            {/* Social + web links */}
            {(user.website || user.instagram || user.facebook_url || user.tiktok_url) && (
              <View style={styles.linkRow}>
                {!!user.website && (
                  <TouchableOpacity
                    onPress={() => openUrl(user.website)}
                    style={[styles.linkBtn, styles.linkBtnPortfolio]}
                    testID="profile-portfolio-link"
                    accessibilityLabel="Open portfolio"
                    activeOpacity={0.82}
                  >
                    {/* Gold gradient fill (stronger than a flat tint) so the
                        pill reads as distinctly premium next to the neutral
                        socials. Bordered to finish the bezel. */}
                    <LinearGradient
                      colors={['rgba(245,166,35,0.28)', 'rgba(245,166,35,0.06)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <GlobeIcon size={18} active weight="regular" />
                  </TouchableOpacity>
                )}
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

            <View style={styles.ctaRow}>
              <Button
                title={editMode ? 'Cancel' : 'Edit profile'}
                variant="secondary"
                onPress={() => setEditMode(!editMode)}
                style={{ flex: 1 }}
                testID="profile-edit-toggle"
              />
              <Button
                title="Share profile"
                variant="ghost"
                onPress={shareProfile}
                style={{ flex: 1 }}
              />
            </View>
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <StatCell label="Followers" value={stats.followers ?? 0} onPress={() => {}} />
            <StatCell label="Following" value={stats.following ?? 0} onPress={() => {}} />
            <StatCell label="Spots"     value={stats.spots_created ?? mySpots.length} />
            <StatCell label="Posts"     value={stats.posts_count ?? myPosts.length} />
          </View>

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
                icon: <ShieldCheck size={12} color={colors.info} />,
              });
            }
            if (plan !== 'free') {
              badges.push({
                key: 'plan', label: planLabel,
                color: colors.primary, bg: 'rgba(245,166,35,0.14)',
                icon: <Crown size={12} color={colors.primary} />,
              });
            }
            if ((user.years_experience ?? 0) >= 3) {
              badges.push({
                key: 'years', label: `${user.years_experience}+ yrs`,
                color: colors.success, bg: 'rgba(16,185,129,0.14)',
                icon: <GraduationCap size={12} color={colors.success} />,
              });
            }
            if ((stats.spots_created ?? mySpots.length) >= 1) {
              badges.push({
                key: 'contrib', label: 'Contributor',
                color: colors.text, bg: colors.surface2,
                icon: <MapPin size={12} color={colors.text} />,
              });
            }
            if ((stats.spots_created ?? mySpots.length) >= 10) {
              badges.push({
                key: 'scout', label: 'Top Scout',
                color: colors.primary, bg: 'rgba(245,166,35,0.14)',
                icon: <Store size={12} color={colors.primary} />,
              });
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

          {/* PRD #4: Premium Upgrade CTA — gold gradient card, only for Free
              users, positioned above role-based tools so it has maximum air. */}
          {plan === 'free' && (
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
                <Text style={styles.upgradeTitle}>Scout smarter. Shoot better.</Text>
                <Text style={styles.upgradeBody}>
                  Unlimited saves, AI shot lists, creator analytics, verified badge — starting at $8/mo.
                </Text>
              </View>
              <View style={styles.upgradeArrow}>
                <Text style={styles.upgradeArrowTxt}>Go Pro →</Text>
              </View>
            </TouchableOpacity>
          )}

          {/* PRD #11: Share-the-app primary CTA moved HIGH on the profile so
              it's visible above the fold. Sits right under the Upgrade CTA
              (or directly below Badges when the user is already Pro/Elite).
              Uses the native Share sheet with referral code auto-appended
              when present so we can track K-factor later. */}
          <TouchableOpacity
            style={styles.shareAppRow}
            onPress={async () => {
              try {
                const ref = (user as any)?.referral_code;
                const urlBase = 'https://lumascout.app';
                const url = ref ? `${urlBase}?ref=${encodeURIComponent(ref)}` : urlBase;
                await Share.share({
                  message: `I'm using LumaScout to find amazing photo spots — come join me 📸\n\n${url}`,
                  url,
                  title: 'LumaScout — photo-spot scouting for photographers',
                });
              } catch {}
            }}
            testID="profile-share-app"
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={['rgba(245,166,35,0.18)', 'rgba(245,166,35,0.04)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.shareAppIcon}>
              <Share2 size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.shareAppTitle}>Share LumaScout with a friend</Text>
              <Text style={styles.shareAppBody}>
                Photographers love finding new spots. Spread the word — unlock Pro perks when referrals subscribe.
              </Text>
            </View>
          </TouchableOpacity>

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
                    <Text style={styles.actionTxt}>Pack{'\n'}Marketplace</Text>
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
            {activeTab === 'posts' && (
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

            {activeTab === 'spots' && (
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

            {activeTab === 'collections' && (
              collections.length === 0
                ? <EmptyState
                    title="Build your first collection"
                    subtitle="Group your favorite spots into curated collections — seasonal picks, bridal locations, or family-friendly."
                    icon={<Store size={28} color={colors.textSecondary} />}
                    action={<Button title="Create a collection" variant="secondary" onPress={() => router.push('/collections')} />}
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
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingVertical: 14, paddingHorizontal: 14,
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  headline: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  proPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
  },
  proTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: space.xl },
  loadingTitle: { color: colors.text, fontFamily: font.display, fontSize: 28 },

  banner: {
    height: 160, backgroundColor: colors.surface1, position: 'relative', overflow: 'hidden',
  },
  bannerFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface1,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
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
      android: { elevation: 2 },
    }),
  },
  bannerEditTxt: { color: '#FFFFFF', fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.3 },
  bannerTopRight: {
    position: 'absolute', top: space.md, right: space.xl, flexDirection: 'row', gap: 8,
  },
  iconBtnDark: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },

  avatarWrap: {
    alignItems: 'center', marginTop: -44,
  },
  avatar: {
    width: 104, height: 104, borderRadius: 52,
    borderWidth: 4, borderColor: colors.bg, backgroundColor: colors.surface2,
  },
  avatarEditBadge: {
    // FIX(Commit 7d): bump size 26→28 and add subtle shadow so it reads as
    // tappable over any avatar colour, not just light-skinned ones.
    position: 'absolute', right: 4, bottom: 4, width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.primary, borderColor: colors.bg, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
      android: { elevation: 3 },
    }),
  },

  headerText: { paddingHorizontal: space.xl, paddingTop: space.md, alignItems: 'center' },
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
  // Premium gold-tinted variant used for the Portfolio (website) link only.
  // Signals "this is where their published work lives" vs. the neutral
  // social pills (Instagram / Facebook / TikTok). Keeps identical 32x32
  // dimensions as the other socials (perfectly aligned row) but layers a
  // gold gradient fill + stronger gold bezel to read as a premium CTA.
  linkBtnPortfolio: {
    overflow: 'hidden',
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.55)',
    borderWidth: 1.2,
  },

  ctaRow: { flexDirection: 'row', gap: 8, marginTop: space.lg, width: '100%' },

  statsRow: {
    flexDirection: 'row', marginTop: space.lg, paddingHorizontal: space.xl,
    gap: 8,
  },
  statCell: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    backgroundColor: colors.surface1, borderRadius: radii.md, borderColor: colors.border, borderWidth: 1,
  },
  statVal: { color: colors.text, fontFamily: font.display, fontSize: 20 },
  statLbl: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 2 },

  actionsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: space.xl, marginTop: space.sm,
  },
  actionCard: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    padding: space.md, borderRadius: radii.md, gap: 6, minHeight: 80,
  },
  adminCard: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12, lineHeight: 16 },
  sectionLabel: {
    color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8,
    textTransform: 'uppercase', paddingHorizontal: space.xl, marginTop: space.xl, marginBottom: space.xs,
  },
  signOutRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: space.lg, marginHorizontal: space.xl, paddingVertical: 10,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent',
  },
  signOutTxt: { color: colors.secondary, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.3 },

  editCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    padding: space.lg, borderRadius: radii.lg, gap: space.md, margin: space.xl,
  },
  editLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 6,
  },
  toggleLabel: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 14, flex: 1 },

  tabStrip: {
    marginTop: space.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tabBtn: { paddingVertical: 12 },
  tabTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 0.2 },
  tabTxtActive: { color: colors.text },
  tabUnderline: {
    height: 2, backgroundColor: colors.primary, marginTop: 8,
    marginHorizontal: -2, borderRadius: 2,
  },

  postCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, padding: space.md, gap: 6,
  },
  postCategory: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
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
    width: '32%', backgroundColor: colors.surface2, borderRadius: radii.sm, overflow: 'hidden',
  },
  // PRD #4: Badges strip
  badgesStrip: {
    paddingHorizontal: space.xl, paddingVertical: space.sm,
    gap: 6,
  },
  badgePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radii.pill, borderWidth: 1,
  },
  badgePillTxt: {
    fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.3,
  },
  // PRD #4: Premium Upgrade CTA for Free users
  upgradeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: space.xl, marginTop: space.md,
    paddingHorizontal: space.md, paddingVertical: 14,
    backgroundColor: colors.surface1,
    borderColor: 'rgba(245,166,35,0.35)', borderWidth: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  upgradeCrown: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(245,166,35,0.2)',
    borderColor: 'rgba(245,166,35,0.45)', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  upgradeTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  upgradeBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  upgradeArrow: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: colors.primary, borderRadius: radii.pill,
  },
  upgradeArrowTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.3 },
  // PRD #11: Share LumaScout row
  shareAppRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: space.xl, marginTop: space.md,
    paddingHorizontal: space.md, paddingVertical: 14,
    backgroundColor: colors.surface1,
    borderColor: 'rgba(245,166,35,0.28)', borderWidth: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  shareAppIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  shareAppTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  shareAppBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 2 },

  aboutCard: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, padding: space.lg, gap: space.sm,
  },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  aboutLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  aboutVal: { color: colors.text, fontFamily: font.body, fontSize: 13, flexShrink: 1, textAlign: 'right' },

  empty: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, textAlign: 'center', paddingVertical: space.xxl },
});
