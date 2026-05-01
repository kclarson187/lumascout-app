import React, { useEffect, useState, useCallback, useMemo } from 'react';import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Dimensions,
  Alert,
  Share,
  Linking,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ExpoLinking from 'expo-linking';
import Head from 'expo-router/head';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, Bookmark, Share2, Flag, MapPin, Sun, Sunrise, Sunset, Cloud,
  Camera, Car, Accessibility, Users, Shield, DogIcon, BabyIcon, TicketIcon, ClockIcon, CheckCircle,
  FolderPlus, MessageSquarePlus, Navigation, Wand2, ChevronRight, Trash2, PenLine,
} from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { formatDistance } from '../../src/utils/distance';
import { resolveImageUrl } from '../../src/utils/image-url';
import ScoreRing from '../../src/components/ScoreRing';
import SpotCard from '../../src/components/SpotCard';
import { Button } from '../../src/components/Button';
import { DetailSkeleton } from '../../src/components/Skeleton';
import AddToCollectionSheet from '../../src/components/AddToCollectionSheet';
import CommunityUploadsSection from '../../src/components/CommunityUploadsSection';
import LatestConditionsSection from '../../src/components/LatestConditionsSection';
import SeasonalTimelineSection from '../../src/components/SeasonalTimelineSection';
import { ActivityBadge, timeAgo } from '../../src/components/FreshnessBits';
import VerifiedBadge from '../../src/components/VerifiedBadge';
import UserBadge from '../../src/components/UserBadge';
import FreshnessBadge from '../../src/components/FreshnessBadge';
import ReportSheet from '../../src/components/ReportSheet';
import ShotListSheet from '../../src/components/ShotListSheet';
import ScoutAICard from '../../src/components/ScoutAICard';
import DeleteConfirmSheet, { SPOT_DELETE_PRESETS } from '../../src/components/DeleteConfirmSheet';
import { goldenHourLabel } from '../../src/utils/sun';

const { width: W } = Dimensions.get('window');

export default function SpotDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = String(params.id || '');
  const { user } = useAuth();
  const isAdminUser = user?.role === 'admin' || user?.role === 'super_admin';
  const [spot, setSpot] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [atcOpen, setAtcOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [shotListOpen, setShotListOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/spots/${id}`);
      setSpot(data);
    } catch (e: any) {
      // FIX(Batch-1 deleted-spot crash): gracefully redirect out when a
      // user opens a deleted/hidden spot (either from a stale list cache,
      // a push notification, or a shared link). Previously an unhandled
      // render below threw because `spot` was null — now we alert and
      // navigate back so the user never sees a blank/crashed screen.
      const status = Number(e?.status || e?.response?.status || 0);
      const isMissing = status === 404 || status === 410;
      Alert.alert(
        isMissing ? 'Spot no longer available' : 'Unable to load spot',
        isMissing
          ? 'This location has been removed or is no longer public.'
          : formatApiError(e),
        [
          {
            text: 'OK',
            onPress: () => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)/explore');
            },
          },
        ],
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // CRITICAL FIX (Apr 2026 #2 — second pass): compute the *effective*
  // ordered images EXACTLY ONCE and use it for the hero carousel, the
  // dot indicators, and any other per-image logic. Previously the dots
  // still pointed at the raw `spot.images` order while the carousel
  // was reordered, which desynchronised the dot count / highlight. We
  // also handle the edge case where `hero_cover_image_url` exists but
  // the matching object isn't in `spot.images` (e.g. override points at
  // a UGC upload not yet in the gallery array) — in that case we
  // PREPEND a synthetic image object so the cover still renders first.
  const orderedImages = useMemo(() => {
    const all: any[] = Array.isArray(spot?.images) ? spot.images : [];
    const coverUrl: string | null = spot?.hero_cover_image_url || null;
    if (!coverUrl) return all;
    const match = all.find((im: any) => im?.image_url === coverUrl);
    if (match) {
      // Move the matching image to position 0
      return [match, ...all.filter((im: any) => im?.image_url !== coverUrl)];
    }
    // Cover URL isn't in spot.images — prepend a synthetic object so the
    // hero carousel can still show the admin-selected cover as image #1.
    return [{ image_url: coverUrl, source: 'cover_override' }, ...all];
  }, [spot?.images, spot?.hero_cover_image_url]);

  // Clamp the active gallery index whenever the ordered array changes
  // so swiping never lands on a phantom slide after the cover is
  // re-selected.
  useEffect(() => {
    if (galleryIdx >= orderedImages.length) {
      setGalleryIdx(0);
    }
  }, [orderedImages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // BATCH 2 polish (Apr 2026): re-fetch whenever the screen regains
  // focus. This is the fix for "I changed the cover photo but the
  // detail page still shows the old one" — previously the screen only
  // loaded once on mount, so returning from the cover editor showed a
  // stale hero. Same fix also helps when admins approve edit requests
  // and then swipe back to see the change live.
  useFocusEffect(
    useCallback(() => {
      if (id) {
        load();
      }
      return undefined;
    }, [id, load]),
  );

  const toggleSave = async () => {
    if (!user) return router.push('/(auth)/login');
    try {
      await api.post(`/spots/${id}/save`);
      load();
    } catch {}
  };

  const toggleFollow = async () => {
    if (!user || !spot?.owner?.user_id) return;
    try {
      await api.post(`/users/${spot.owner.user_id}/follow`);
      load();
    } catch {}
  };

  // May 2026 batch #4 — canonical spot URL helper (single source of truth
  // for share links + OG meta). Priority order:
  //   1. EXPO_PUBLIC_WEB_BASE_URL (production web host, once the web
  //      bundle is deployed to its final domain — prefer this for
  //      iMessage/Slack/WhatsApp preview cards).
  //   2. EXPO_PUBLIC_BACKEND_URL (same-origin API + web bundle in
  //      preview/dev environments — works today in staging).
  //   3. Mobile Linking.createURL fallback (`lumascout://spot/:id`) for
  //      when neither host is configured and we're on-device — never
  //      trust this for OG/preview cards, but it lets QR-coded links
  //      open in-app for testers.
  const spotPublicUrl = useMemo(() => {
    const webBase = (process.env.EXPO_PUBLIC_WEB_BASE_URL || '').replace(/\/+$/, '');
    const backendBase = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
    const base = webBase || backendBase;
    if (base) return `${base}/spot/${id}`;
    // Last-resort: scheme-based deep link. Shareable to devices with
    // the app installed; useless to anyone else. NEVER emit the dead
    // lumascout.app host — it doesn't serve the web bundle yet.
    try {
      return ExpoLinking.createURL(`/spot/${id}`);
    } catch {
      return `/spot/${id}`;
    }
  }, [id]);

  const onShare = async () => {
    // May 2026 batch #4 — native share sheet + web fallback.
    //   Native: React Native's Share.share() surfaces the platform
    //     share sheet (Messages, Mail, WhatsApp, Slack, AirDrop, etc.).
    //   Web: react-native-web's Share polyfill is limited — we prefer
    //     the Web Share API where available, falling back to copy-to-
    //     clipboard with a toast.
    try {
      const location = [spot.city, spot.state].filter(Boolean).join(', ');
      const summary = (spot.description || '').trim().slice(0, 160);
      const lines = [
        spot.title,
        location ? `📍 ${location}` : null,
        summary,
        spotPublicUrl,
      ].filter(Boolean);
      const message = lines.join('\n');

      if (Platform.OS === 'web') {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        // Prefer Web Share API — shows the real system share sheet on
        // iOS Safari, Android Chrome, Edge.
        if (nav?.share) {
          try {
            await nav.share({
              title: spot.title,
              text: location ? `${spot.title} — ${location}` : spot.title,
              url: spotPublicUrl,
            });
            return;
          } catch (e: any) {
            // User cancelled — silently no-op (navigator.share rejects
            // with AbortError on cancel). Only bail if it's a real
            // error.
            if (e?.name === 'AbortError') return;
          }
        }
        // Fallback: copy the link and show an Alert so the user has
        // something actionable. Alert on web renders as a simple modal.
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(spotPublicUrl);
          Alert.alert('Link copied', `Paste it anywhere to share:\n${spotPublicUrl}`);
          return;
        }
        // Final fallback: open mail + sms client selector
        Alert.alert(
          'Share this spot',
          `Copy the link below:\n\n${spotPublicUrl}`,
          [{ text: 'OK' }],
        );
        return;
      }

      // Native path — system share sheet.
      await Share.share({
        message,
        url: spotPublicUrl,           // iOS uses this dedicated field
        title: spot.title,
      });
    } catch (e: any) {
      // Swallow silent cancellations; surface real errors.
      if (e?.message && !/cancel/i.test(e.message)) {
        Alert.alert("Couldn't share", e.message);
      }
    }
  };

  // May 2026 batch #4 update #2.1 — true HARD delete.
  //
  // Unified flow for both real images and cover-override synthetics:
  //   · Always call DELETE /admin/spots/:id/images/:identifier
  //   · identifier = image_id OR image_url (backend accepts either)
  //   · Backend detects cover-override case and clears hero_cover_image_url
  //     + admin_cover_override AND hard-unlinks the file on disk (if local
  //     and not referenced elsewhere).
  //   · No ghost data: the photo is gone from DB, disk, and every UI path.
  const onDeletePhoto = useCallback(async (img: any) => {
    if (!isAdminUser || !img) return;
    const identifier = img.image_id || img.image_url;
    if (!identifier) {
      Alert.alert("Couldn't delete", 'This photo is missing an identifier.');
      return;
    }
    const confirm = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Delete this photo?',
        `This will permanently remove the photo from ${spot?.title || 'this spot'} — including the file on the server. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!confirm) return;

    // Optimistic UI: hide locally, revert on failure.
    const prevSpot = spot;
    const prevIdx = galleryIdx;
    const isCoverOverride = img.source === 'cover_override';
    setSpot((s: any) => {
      if (!s) return s;
      if (isCoverOverride) {
        // Hide the synthetic cover row by clearing the fields that feed
        // the orderedImages memo.
        return { ...s, hero_cover_image_url: null, admin_cover_override: null };
      }
      const kept = (s.images || []).filter(
        (im: any) => (im.image_id || im.image_url) !== identifier,
      );
      return { ...s, images: kept };
    });
    setGalleryIdx(0);
    try {
      await api.delete(`/admin/spots/${id}/images/${encodeURIComponent(identifier)}`);
      // Refresh authoritative state (picks up auto-cover-promotion +
      // any file-cleanup metadata from the server).
      await load();
    } catch (e: any) {
      setSpot(prevSpot);
      setGalleryIdx(prevIdx);
      Alert.alert("Couldn't delete photo", formatApiError(e) || 'Please try again.');
    }
  }, [isAdminUser, id, spot, galleryIdx, load]);

  const onReport = () => {
    if (!user) return router.push('/(auth)/login');
    setReportOpen(true);
  };

  const submitSuperDelete = async (code: string | null, note: string) => {
    try {
      await api.delete(`/admin/spots/${id}`, {
        reason_code: code || undefined,
        reason_note: note || undefined,
      });
      Alert.alert('Spot deleted', 'The spot has been permanently removed.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      throw new Error(formatApiError(e));
    }
  };

  if (loading || !spot) {
    return <DetailSkeleton />;
  }

  const lightScore = Math.round(((spot.sunrise_rating + spot.sunset_rating + spot.morning_golden_hour_rating + spot.evening_golden_hour_rating) / 4) * 20);
  const accessScore = Math.round(((5 - (spot.permit_required ? 2 : 0) - (spot.fee_required ? 1 : 0) + (spot.accessible ? 1 : 0)) / 5) * 100);
  const safetyScore = (spot.safety_rating || 3) * 20;
  const varietyScore = (spot.variety_rating || 3) * 20;
  const crowdScore = (6 - (spot.crowd_level || 3)) * 20;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* May 2026 batch #4(b) — per-spot OG / Twitter card meta tags.
          WEB ONLY. expo-router/head only produces useful output on the
          web bundle (react-helmet-async renders into <head> for SEO
          + social link previews). On native iOS/Android it requires
          a `plugins: [["expo-router", { origin: "<url>" }]]` config
          in app.json to set up Apple Handoff — without it, the SDK
          fires a dev-time Alert on every render. We don't need
          Handoff (that's a separate feature we'll wire in #4c), so
          we simply don't render Head on native. */}
      {Platform.OS === 'web' ? (
        <Head>
          <title>{`${spot.title} — LumaScout`}</title>
          <meta name="description" content={(spot.description || '').slice(0, 180)} />
          <meta property="og:type" content="website" />
          <meta property="og:title" content={spot.title} />
          <meta
            property="og:description"
            content={
              [spot.city, spot.state].filter(Boolean).join(', ')
                ? `${[spot.city, spot.state].filter(Boolean).join(', ')} — ${(spot.description || '').slice(0, 140)}`
                : (spot.description || '').slice(0, 180)
            }
          />
          <meta property="og:url" content={spotPublicUrl} />
          {orderedImages[0]?.image_url ? (
            <meta property="og:image" content={resolveImageUrl(orderedImages[0].image_url)} />
          ) : null}
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={spot.title} />
          {orderedImages[0]?.image_url ? (
            <meta name="twitter:image" content={resolveImageUrl(orderedImages[0].image_url)} />
          ) : null}
        </Head>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setGalleryIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
          >
            {/* All image rendering driven by `orderedImages` memo — see
                the CRITICAL FIX comment near the load() hook. Single
                source of truth keeps the hero carousel, dot indicators,
                and galleryIdx swipe state perfectly in sync. */}
            {orderedImages.map((img: any, i: number) => (
              <Image key={img.image_url || i} source={{ uri: resolveImageUrl(img.image_url) }} style={styles.heroImg} resizeMode="cover" />
            ))}
          </ScrollView>
          <LinearGradient
            colors={['rgba(10,10,10,0.85)', 'transparent']}
            style={styles.heroGradTop}
          />
          <LinearGradient
            colors={['transparent', 'rgba(10,10,10,0.95)']}
            style={styles.heroGradBottom}
          />
          <SafeAreaView style={styles.heroHead} edges={['top']}>
            <TouchableOpacity onPress={() => router.back()} style={styles.headBtn} testID="spot-back">
              <ChevronLeft color={colors.text} size={22} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onShare} style={styles.headBtn} testID="spot-share">
              <Share2 color={colors.text} size={18} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onReport} style={styles.headBtn} testID="spot-report">
              <Flag color={colors.text} size={18} />
            </TouchableOpacity>
            {/* Apr 2026 — featured-photo polish: spot owners (creators)
                can also access the cover editor to choose their featured
                photo. Backend now allows owner+admin (was admin-only). */}
            {(isAdminUser || (!!user && spot?.created_by === user?.user_id)) && (
              <TouchableOpacity
                onPress={() => router.push(`/admin/spots/${id}/cover`)}
                style={[styles.headBtn, styles.headBtnAdmin]}
                testID="spot-admin-edit-cover"
                accessibilityLabel={isAdminUser ? "Edit cover photo (admin)" : "Choose featured photo"}
              >
                <Wand2 color={colors.textInverse} size={16} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={toggleSave} style={[styles.headBtn, { backgroundColor: spot.is_saved ? colors.primary : 'rgba(0,0,0,0.5)' }]} testID="spot-save">
              <Bookmark color={spot.is_saved ? colors.textInverse : colors.text} size={18} fill={spot.is_saved ? colors.textInverse : 'transparent'} />
            </TouchableOpacity>
          </SafeAreaView>
          <View style={styles.dots}>
            {orderedImages.map((img: any, i: number) => (
              <View key={img.image_url || `d${i}`} style={[styles.dot, i === galleryIdx && styles.dotActive]} />
            ))}
          </View>
          {/* May 2026 batch #4 item #2.1 — ADMIN photo delete pill.
              Positioned BOTTOM-LEFT so it never covers the share /
              bookmark / wand / report buttons in the header row.
              Single "DELETE" label — unified flow for real images AND
              cover overrides. Backend hard-deletes both the DB row and
              the underlying upload file on disk (when local +
              unreferenced by any other spot). Render-time gated on
              role — zero admin surface for non-admins. */}
          {isAdminUser && orderedImages[galleryIdx] && (orderedImages[galleryIdx].image_id || orderedImages[galleryIdx].image_url) ? (
            <>
              <TouchableOpacity
                onPress={() => onDeletePhoto(orderedImages[galleryIdx])}
                style={styles.photoDeletePill}
                testID="spot-admin-delete-photo"
                accessibilityLabel={`Delete photo ${galleryIdx + 1} of ${orderedImages.length} (admin — hard delete)`}
                hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
              >
                <Trash2 color="#fff" size={14} strokeWidth={2.25} />
                <Text style={styles.photoDeletePillTxt}>DELETE</Text>
              </TouchableOpacity>
              {/* ADMIN context tag — bottom-RIGHT so it mirrors the
                  DELETE pill cleanly, with the photo position counter.
                  Purely informational (non-tappable). */}
              <View style={styles.photoAdminTag} pointerEvents="none">
                <Shield color={colors.primary} size={11} />
                <Text style={styles.photoAdminTagTxt}>
                  ADMIN · {galleryIdx + 1} / {orderedImages.length}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.content}>
          {spot.visibility_status === 'pending_review' && user?.user_id === spot.owner_user_id && (
            <View style={styles.pendingBanner}>
              <View style={styles.pendingDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingTitle}>Pending moderation review</Text>
                <Text style={styles.pendingBody}>
                  Only you can see this spot. Our team reviews new public submissions to keep quality high — usually within 24h.
                </Text>
              </View>
            </View>
          )}
          {spot.visibility_status === 'rejected' && user?.user_id === spot.owner_user_id && (
            <View style={[styles.pendingBanner, { borderColor: colors.secondary, backgroundColor: 'rgba(208,72,72,0.08)' }]}>
              <View style={[styles.pendingDot, { backgroundColor: colors.secondary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingTitle}>Submission rejected</Text>
                <Text style={styles.pendingBody}>
                  This spot didn't meet our public guidelines. It's private to you — edit and resubmit, or make it private/followers-only.
                </Text>
              </View>
            </View>
          )}

          {/* BATCH 2 (Apr 2026): owner-only "Request edits" entry point.
              Admins / super_admins don't see this — they use direct
              edit via the admin menu. Keeps the flow unambiguous. */}
          {user?.user_id === spot.owner_user_id && user?.role !== 'admin' && user?.role !== 'super_admin' && (
            <Pressable
              onPress={() => router.push(`/spot/${String(id)}/request-edit` as any)}
              style={styles.requestEditBtn}
              testID="spot-request-edit"
            >
              <Text style={styles.requestEditTxt}>Request edits to this spot</Text>
            </Pressable>
          )}
          <Text style={styles.title}>{spot.title}</Text>
          <View style={styles.metaRow}>
            <MapPin size={14} color={colors.textSecondary} />
            <Text style={styles.meta}>{spot.city}, {spot.state}</Text>
            {(() => { const d = formatDistance(spot); return d ? <Text style={styles.meta}>  ·  {d}</Text> : null; })()}
          </View>

          {(spot.freshness && spot.freshness !== 'unknown') && (
            <View style={{ alignSelf: 'flex-start', marginTop: 6, flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <FreshnessBadge freshness={spot.freshness} label={spot.freshness_label} />
              <ActivityBadge lastActivityAt={spot.last_activity_at} recentUploadCount7d={spot.recent_upload_count_7d} />
            </View>
          )}
          {spot.on_site_verified || spot.capture_source === 'camera_capture' ? (
            <View style={styles.onSiteBadge} testID="spot-on-site-verified">
              <MapPin size={11} color={colors.textInverse} />
              <Text style={styles.onSiteBadgeTxt}>On-Site Verified</Text>
            </View>
          ) : null}
          {(!spot.freshness || spot.freshness === 'unknown') && spot.last_activity_at ? (
            <View style={{ alignSelf: 'flex-start', marginTop: 6 }}>
              <ActivityBadge lastActivityAt={spot.last_activity_at} recentUploadCount7d={spot.recent_upload_count_7d} />
            </View>
          ) : null}

          <View style={styles.tagRow}>
            {(spot.shoot_types || []).map((t: string) => (
              <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
            ))}
            {(spot.style_tags || []).slice(0, 3).map((t: string) => (
              <View key={`s-${t}`} style={[styles.tag, { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: 1 }]}>
                <Text style={[styles.tagText, { color: colors.textSecondary }]}>{t}</Text>
              </View>
            ))}
          </View>

          {/* Golden-hour window — prominent, actionable. Uses the spot's local
              timezone (handled by goldenHourLabel). Hidden for polar regions
              / missing coords / detail pages where coords are deliberately
              redacted. PRD item #3. */}
          {(() => {
            const g = goldenHourLabel(spot.latitude, spot.longitude);
            if (!g) return null;
            return (
              <View style={styles.goldenWindow} testID="spot-golden-window">
                <View style={styles.goldenIcon}>
                  <Sun size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.goldenTitle}>{g}</Text>
                  <Text style={styles.goldenSub}>Best light for today · local time at the spot</Text>
                </View>
              </View>
            );
          })()}

          {/* May 2026 — Best light notes (free-form uploader guidance).
              Shown whenever the uploader has filled in `best_light_notes`
              (see add.tsx step #3). When that field is empty we fall back
              to the legacy structured `best_time_of_day` chip so older
              spots submitted before the free-form field existed still
              surface something actionable. */}
          {spot.best_light_notes && String(spot.best_light_notes).trim() ? (
            <View style={styles.bestLightCard} testID="spot-best-light-notes">
              <View style={styles.bestLightIcon}>
                <Sun size={14} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bestLightLabel}>Best light</Text>
                <Text style={styles.bestLightBody}>{String(spot.best_light_notes).trim()}</Text>
              </View>
            </View>
          ) : spot.best_time_of_day && spot.best_time_of_day !== 'any' ? (
            <View style={styles.bestTimeChipRow} testID="spot-best-time-chip">
              <View style={styles.bestTimeChip}>
                <Sun size={11} color={colors.primary} />
                <Text style={styles.bestTimeChipTxt}>
                  Best at {String(spot.best_time_of_day).replace(/_/g, ' ')}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Owner row */}
          {spot.owner && (
            <View style={styles.ownerRow}>
              <TouchableOpacity onPress={() => router.push(`/user/${spot.owner.user_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                {spot.owner.avatar_url ? (
                  <Image source={{ uri: spot.owner.avatar_url }} style={styles.ownerAvatar} />
                ) : (
                  <View style={[styles.ownerAvatar, { backgroundColor: colors.surface2 }]} />
                )}
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 }}>{spot.owner.name}</Text>
                    <VerifiedBadge status={spot.owner.verification_status} variant="inline" size={14} />
                    <UserBadge user={spot.owner} variant="inline" />
                  </View>
                  <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12 }}>
                    {spot.owner.verification_status === 'verified' ? 'Verified contributor' : 'Contributor'}
                  </Text>
                </View>
              </TouchableOpacity>
              {user && user.user_id !== spot.owner.user_id && (
                <Button title="Follow" variant="secondary" onPress={toggleFollow} testID="spot-follow" style={{ paddingVertical: 10, paddingHorizontal: 18 }} />
              )}
            </View>
          )}

          {spot.description ? <Text style={styles.desc}>{spot.description}</Text> : null}

          {spot.location_display_mode === 'approximate' && (
            <View style={styles.privacyNote}>
              <MapPin size={14} color={colors.info} />
              <Text style={styles.privacyNoteTxt}>Approximate location shown — exact coordinates protected.</Text>
            </View>
          )}
          {spot.location_display_mode === 'hidden' && (
            <View style={styles.privacyNote}>
              <MapPin size={14} color={colors.info} />
              <Text style={styles.privacyNoteTxt}>Map pin hidden by owner. Contact contributor for details.</Text>
            </View>
          )}

          {/* Community uploads + updates CTAs (Feature 9) */}
          {!!spot.spot_id && (
            <View style={styles.communityCtaRow}>
              <TouchableOpacity
                style={styles.communityCtaPrimary}
                onPress={() => router.push(`/spot/${spot.spot_id}/upload` as any)}
                activeOpacity={0.85}
                testID="spot-add-photos"
              >
                <Camera size={16} color={colors.textInverse} />
                <Text style={styles.communityCtaPrimaryTxt}>Add Recent Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.communityCtaSecondary}
                onPress={() => router.push(`/spot/${spot.spot_id}/update` as any)}
                activeOpacity={0.85}
                testID="spot-add-update"
              >
                <PenLine size={16} color={colors.primary} />
                <Text style={styles.communityCtaSecondaryTxt}>Add Update</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Get directions — shown whenever an exact pin is available */}
          {spot.location_display_mode !== 'hidden' && spot.latitude != null && spot.longitude != null && (
            <TouchableOpacity
              style={styles.directionsBtn}
              onPress={() => {
                const lat = spot.latitude;
                const lng = spot.longitude;
                const cityPart = [spot.city, spot.state].filter(Boolean).join(', ');
                // Give Apple/Google Maps a human-friendly destination label so
                // the dropped pin doesn't reverse-geocode to a random ZIP.
                const labelRaw = cityPart ? `${spot.title} · ${cityPart}` : spot.title;
                const label = encodeURIComponent(labelRaw || 'LumaScout spot');
                const iosUrl = `maps://?q=${label}&ll=${lat},${lng}&daddr=${lat},${lng}&dirflg=d`;
                const iosFallback = `http://maps.apple.com/?q=${label}&ll=${lat},${lng}&daddr=${lat},${lng}&dirflg=d`;
                // Android: geo: scheme with labeled pin
                const androidUrl = `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
                const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
                const openBest = async () => {
                  if (Platform.OS === 'ios') {
                    const canOpen = await Linking.canOpenURL(iosUrl).catch(() => false);
                    return Linking.openURL(canOpen ? iosUrl : iosFallback);
                  }
                  if (Platform.OS === 'android') {
                    const canOpen = await Linking.canOpenURL(androidUrl).catch(() => false);
                    return Linking.openURL(canOpen ? androidUrl : webUrl);
                  }
                  return Linking.openURL(webUrl);
                };
                openBest().catch(() => Alert.alert('Could not open maps', 'Please try again.'));
              }}
              testID="spot-get-directions"
            >
              <Navigation size={16} color={colors.textInverse} />
              <View style={{ flex: 1 }}>
                <Text style={styles.directionsBtnTitle}>Get directions</Text>
                <Text style={styles.directionsBtnSub} numberOfLines={1}>
                  {spot.title}{spot.city ? ` · ${spot.city}` : ''}{spot.state ? `, ${spot.state}` : ''}
                </Text>
              </View>
            </TouchableOpacity>
          )}

          {/* AI Shot list */}
          {!!spot.spot_id && (
            <TouchableOpacity
              style={styles.aiBtn}
              onPress={() => setShotListOpen(true)}
              testID="spot-shot-list"
              activeOpacity={0.85}
            >
              <View style={styles.aiIconBubble}>
                <Wand2 size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiBtnTitle}>AI shot list</Text>
                <Text style={styles.aiBtnSub} numberOfLines={1}>
                  6–8 composition ideas tailored to {spot.title}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          {/* Scout AI — inline helper tied to this spot (PRD Scout AI Phase 1). */}
          {!!spot.spot_id && (
            <ScoutAICard
              placement="spot_detail"
              spotId={spot.spot_id}
              subtitle={`Ask about fit, best light, or compare nearby options.`}
            />
          )}

          {/* Scores */}
          <Text style={styles.sectionH}>Shoot Intelligence</Text>
          <View style={styles.scoreGrid}>
            <ScoreRing score={spot.shoot_score} label="Overall" size={72} />
            <ScoreRing score={lightScore} label="Light" />
            <ScoreRing score={accessScore} label="Access" />
            <ScoreRing score={varietyScore} label="Variety" />
            <ScoreRing score={crowdScore} label="Crowd" />
            <ScoreRing score={safetyScore} label="Safety" />
          </View>

          {/* Info cards */}
          <Text style={styles.sectionH}>Best time</Text>
          <View style={styles.infoRow}>
            <InfoCard icon={<Sunrise size={18} color={colors.primary} />} label="Sunrise" value={`${spot.sunrise_rating}/5`} />
            <InfoCard icon={<Sunset size={18} color={colors.primary} />} label="Sunset" value={`${spot.sunset_rating}/5`} />
            <InfoCard icon={<Sun size={18} color={colors.primary} />} label="Golden AM" value={`${spot.morning_golden_hour_rating}/5`} />
            <InfoCard icon={<Sun size={18} color={colors.primary} />} label="Golden PM" value={`${spot.evening_golden_hour_rating}/5`} />
          </View>

          <Text style={styles.sectionH}>Logistics</Text>
          <View style={{ gap: space.sm }}>
            {spot.parking_notes && <LogisticsRow icon={<Car size={16} color={colors.primary} />} label="Parking" text={spot.parking_notes} />}
            {spot.walking_notes && <LogisticsRow icon={<MapPin size={16} color={colors.primary} />} label="Walking" text={spot.walking_notes} />}
            {spot.permit_required && <LogisticsRow icon={<TicketIcon size={16} color={colors.warning} />} label="Permit" text={spot.permit_notes || 'Permit required'} />}
            {spot.fee_required && <LogisticsRow icon={<TicketIcon size={16} color={colors.warning} />} label="Fee" text={spot.fee_notes || 'Entry fee'} />}
            {spot.lens_recommendations && <LogisticsRow icon={<Camera size={16} color={colors.primary} />} label="Lens" text={spot.lens_recommendations} />}
          </View>

          {/* Item #1 (Apr 2026) — Land Access disclosure */}
          {(spot.land_access || spot.access_notes) ? (
            <View style={{
              marginTop: space.lg,
              padding: 14,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: spot.land_access === 'private' ? 'rgba(157,89,255,0.45)' : 'rgba(34,197,94,0.35)',
              backgroundColor: spot.land_access === 'private' ? 'rgba(157,89,255,0.08)' : 'rgba(34,197,94,0.06)',
              gap: 6,
            }}>
              <Text style={{
                color: spot.land_access === 'private' ? '#c8a8ff' : '#22c55e',
                fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.6,
              }}>
                {spot.land_access === 'public' ? 'PUBLIC LAND'
                  : spot.land_access === 'private' ? 'PRIVATE LAND — PERMISSION REQUIRED'
                  : 'LAND ACCESS UNCONFIRMED'}
              </Text>
              {spot.access_notes ? (
                <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 }}>
                  {spot.access_notes}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.badgesRow}>
            {spot.dog_friendly && <Badge label="Dog friendly" />}
            {spot.kid_friendly && <Badge label="Kid friendly" />}
            {spot.accessible && <Badge label="Accessible" />}
            {spot.indoor && <Badge label="Indoor" />}
          </View>

          {spot.last_verified_at && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md }}>
              <CheckCircle size={14} color={colors.success} />
              <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12 }}>
                Last verified {new Date(spot.last_verified_at).toLocaleDateString()}
              </Text>
            </View>
          )}

          {/* Reviews */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xl }}>
            <Text style={styles.sectionH}>Field notes · {spot.review_count || 0}</Text>
            <TouchableOpacity onPress={() => router.push(`/review/${id}`)} testID="spot-new-review">
              <Text style={{ color: colors.primary, fontFamily: font.bodyMedium, fontSize: 13 }}>Add check-in</Text>
            </TouchableOpacity>
          </View>
          <View style={{ gap: space.md, marginTop: space.sm }}>
            {(spot.reviews || []).slice(0, 3).map((r: any) => (
              <View key={r.review_id} style={styles.reviewCard}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                  {r.user?.avatar_url ? (
                    <Image source={{ uri: r.user.avatar_url }} style={{ width: 28, height: 28, borderRadius: 14 }} />
                  ) : <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface2 }} />}
                  <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 }}>{r.user?.name || 'Photographer'}</Text>
                  <Text style={{ color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 }}>{r.overall_rating}★</Text>
                </View>
                {r.comment ? <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 }}>{r.comment}</Text> : null}
              </View>
            ))}
            {(!spot.reviews || spot.reviews.length === 0) && (
              <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 13 }}>No reviews yet — be the first!</Text>
            )}
          </View>

          {/* Community uploads (Feature 9 — retention) */}
          {!!spot.spot_id && (
            <>
              <View style={styles.sectionHeadRow}>
                <Text style={styles.sectionH}>Recent community uploads</Text>
                {spot.last_activity_at ? (
                  <Text style={styles.sectionHsub}>Updated {timeAgo(spot.last_activity_at)}</Text>
                ) : null}
              </View>
              <View style={{ marginTop: space.md, marginHorizontal: -space.xl }}>
                <CommunityUploadsSection spotId={spot.spot_id} />
              </View>
            </>
          )}

          {/* Latest conditions (text updates feed) */}
          {!!spot.spot_id && (
            <>
              <Text style={[styles.sectionH, { marginTop: space.xl }]}>Latest conditions</Text>
              <View style={{ marginTop: space.md, marginHorizontal: -space.xl }}>
                <LatestConditionsSection spotId={spot.spot_id} />
              </View>
            </>
          )}

          {/* Seasonal timeline (Phase 2) — only renders if uploads span seasons */}
          {!!spot.spot_id && spot.seasonal_timeline_total > 0 ? (
            <>
              <Text style={[styles.sectionH, { marginTop: space.xl }]}>Through the seasons</Text>
              <View style={{ marginTop: space.md, marginHorizontal: -space.xl }}>
                <SeasonalTimelineSection spotId={spot.spot_id} initial={spot.seasonal_timeline} />
              </View>
            </>
          ) : null}

          {/* Similar */}
          {spot.similar_spots && spot.similar_spots.length > 0 && (
            <>
              <Text style={[styles.sectionH, { marginTop: space.xl }]}>Similar nearby</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.md, marginHorizontal: -space.xl }} contentContainerStyle={{ paddingHorizontal: space.xl, gap: 12 }}>
                {spot.similar_spots.map((s: any) => (
                  <SpotCard key={s.spot_id} spot={s} width={240} />
                ))}
              </ScrollView>
            </>
          )}

          {/* BATCH 2 (Apr 2026): discoverable admin photo manager
              CTA. Prior to this, the only entry point was a small
              wand icon in the hero overlay that users were missing.
              This wide card makes "change the cover / reorder photos"
              obvious right below the spot body — visible to admins
              AND super admins. */}
          {isAdminUser && (
            <TouchableOpacity
              style={sadStyles.photoMgrCard}
              onPress={() => router.push(`/admin/spots/${id}/cover`)}
              testID="admin-manage-photos"
              activeOpacity={0.85}
            >
              <View style={sadStyles.photoMgrIcon}>
                <Wand2 size={16} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={sadStyles.photoMgrTitle}>Manage photos</Text>
                <Text style={sadStyles.photoMgrSub} numberOfLines={2}>
                  Change the cover, reorder the gallery, remove weak photos. Updates Explore + map + saved instantly.
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}

          {/* Super-admin destructive controls — not shown to regular admins/users. */}
          {user?.role === 'super_admin' && (
            <View style={sadStyles.dangerZone}>
              <View style={sadStyles.dangerHead}>
                <Shield size={14} color={colors.secondary} />
                <Text style={sadStyles.dangerTitle}>Super admin tools</Text>
              </View>
              <Text style={sadStyles.dangerBody}>
                Permanently remove this spot and clean up saves, reviews, check-ins, reports,
                collection references, and community-post links. A snapshot is kept for audit.
              </Text>
              <TouchableOpacity
                style={sadStyles.dangerBtn}
                onPress={() => setDeleteOpen(true)}
                testID="super-delete-spot"
              >
                <Trash2 size={14} color="#fff" />
                <Text style={sadStyles.dangerBtnTxt}>Delete spot permanently</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {user && (
        <View style={styles.actionBar}>
          <TouchableOpacity style={styles.actBtn} onPress={toggleSave} testID="spot-action-save">
            <Bookmark size={20} color={spot.is_saved ? colors.primary : colors.text} fill={spot.is_saved ? colors.primary : 'transparent'} />
            <Text style={[styles.actTxt, spot.is_saved && { color: colors.primary }]}>Saved</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actBtn} onPress={() => setAtcOpen(true)} testID="spot-action-collection">
            <FolderPlus size={20} color={colors.text} />
            <Text style={styles.actTxt}>Add</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actBtn, styles.actBtnPrimary]}
            onPress={() => router.push(`/review/${id}`)}
            testID="spot-action-review"
          >
            <MessageSquarePlus size={20} color={colors.textInverse} />
            <Text style={[styles.actTxt, { color: colors.textInverse }]}>Check-in</Text>
          </TouchableOpacity>
        </View>
      )}

      <AddToCollectionSheet visible={atcOpen} onClose={() => setAtcOpen(false)} spotId={id} />
      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="spot"
        targetId={id}
        title={`Report "${spot.title}"`}
      />
      <ShotListSheet
        visible={shotListOpen}
        onClose={() => setShotListOpen(false)}
        spotId={id}
        spotTitle={spot.title}
      />

      <DeleteConfirmSheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={submitSuperDelete}
        title="Delete this spot?"
        warning="Hard delete — the spot is removed from feeds, search, and the map. Saves, reviews, check-ins, reports and collection references are cleaned up. A snapshot is archived. Cannot be undone in the app."
        targetLabel={`${spot.title}  ·  ${spot.city || ''}${spot.state ? ', ' + spot.state : ''}`}
        confirmPhrase="delete"
        presets={SPOT_DELETE_PRESETS}
        destructiveCta="Delete spot permanently"
      />
    </View>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.infoCard}>
      {icon}
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function LogisticsRow({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <View style={styles.logRow}>
      <View style={styles.logIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.logLabel}>{label}</Text>
        <Text style={styles.logText}>{text}</Text>
      </View>
    </View>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: { width: W, height: W, position: 'relative', backgroundColor: colors.surface2 },
  heroImg: { width: W, height: W },
  heroGradTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  heroGradBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 },
  heroHead: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.sm,
  },
  headBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  headBtnAdmin: {
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  dots: {
    position: 'absolute', bottom: space.md, alignSelf: 'center',
    flexDirection: 'row', gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 20, backgroundColor: colors.primary },
  // May 2026 batch #4 update #2.1 — admin photo DELETE pill.
  //
  // Moved from top-right to BOTTOM-LEFT (May 2026) so it never
  // collides with the share / report / wand / bookmark buttons in
  // the header row. Positioned above the dots indicator with an extra
  // 12px margin so the two don't compete visually.
  //
  // Clean + professional: slightly smaller pill (32px high), softer
  // red (#dc2626 at 92% alpha), tighter typography. Hairline white
  // border + subtle drop shadow lift it off any photo.
  photoDeletePill: {
    position: 'absolute',
    bottom: space.lg + 16,      // above the dots row
    left: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  photoDeletePillTxt: {
    color: '#fff',
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 0.9,
  },
  // ADMIN context tag — mirrored on BOTTOM-RIGHT. Gold-tinted,
  // informational only (non-tappable). Height matched to the pill
  // so both sit cleanly on the same baseline above the dots row.
  photoAdminTag: {
    position: 'absolute',
    bottom: space.lg + 16,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,166,35,0.45)',
  },
  photoAdminTagTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
  },
  content: { padding: space.xl, gap: 6 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 32, letterSpacing: -0.5, lineHeight: 38 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  onSiteBadge: {
    alignSelf: 'flex-start', marginTop: 6,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: '#16a34a',
  },
  onSiteBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  tag: { backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  tagText: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  // PRD #3 Golden-hour window
  goldenWindow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: space.md,
    paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.38)', borderWidth: 1,
    borderRadius: radii.md,
  },
  goldenIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  goldenTitle: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 15, letterSpacing: 0.2 },
  goldenSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  // May 2026 — Best light notes card (primary: shown when `best_light_notes`
  // exists). Intentionally softer than the golden-hour window: this is
  // uploader-authored prose about *how the light behaves at this spot*
  // (e.g. "Sidelight from 8-10am hits the east cliff face; shadow falls
  // after noon"), so we use a neutral info-card treatment rather than the
  // high-contrast amber of the daily golden-hour computation.
  bestLightCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginTop: space.md,
    paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md,
  },
  bestLightIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  bestLightLabel: {
    color: colors.textSecondary, fontFamily: font.bodyMedium,
    fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  bestLightBody: {
    color: colors.text, fontFamily: font.body,
    fontSize: 14, lineHeight: 20, marginTop: 3,
  },
  // Legacy fallback chip — shown only when `best_light_notes` is absent.
  bestTimeChipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md,
  },
  bestTimeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
  },
  bestTimeChipTxt: {
    color: colors.primary, fontFamily: font.bodyMedium,
    fontSize: 11, letterSpacing: 0.3, textTransform: 'capitalize',
  },
  ownerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: space.xl, padding: space.md,
    backgroundColor: colors.surface1, borderRadius: radii.md,
    borderColor: colors.border, borderWidth: 1,
  },
  ownerAvatar: { width: 40, height: 40, borderRadius: 20 },
  desc: { color: colors.textSecondary, fontFamily: font.body, fontSize: 15, lineHeight: 22, marginTop: space.lg },
  privacyNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md,
    padding: space.md, backgroundColor: 'rgba(96,165,250,0.1)',
    borderColor: 'rgba(96,165,250,0.3)', borderWidth: 1, borderRadius: radii.md,
  },
  privacyNoteTxt: { color: colors.info, fontFamily: font.bodyMedium, fontSize: 12, flex: 1, lineHeight: 16 },
  directionsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: space.md, paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: colors.primary, borderRadius: radii.md,
  },
  directionsBtnTitle: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  directionsBtnSub: { color: 'rgba(255,255,255,0.82)', fontFamily: font.bodyMedium, fontSize: 11, marginTop: 2 },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: space.sm, paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: colors.surface1, borderRadius: radii.md,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
  },
  aiIconBubble: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  aiBtnTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  aiBtnSub: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 2 },
  sectionH: { color: colors.text, fontFamily: font.display, fontSize: 20, marginTop: space.xl, letterSpacing: -0.2 },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.xl },
  sectionHsub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  // Community CTAs (Feature 9) — primary photo upload + secondary text update.
  communityCtaRow: { flexDirection: 'row', gap: 8, marginTop: space.md, marginBottom: space.sm },
  communityCtaPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.primary },
  communityCtaPrimaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
  communityCtaSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)' },
  communityCtaSecondaryTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 },
  scoreGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: space.md,
    padding: space.lg, backgroundColor: colors.surface1, borderRadius: radii.lg,
    borderColor: colors.border, borderWidth: 1, justifyContent: 'space-between',
  },
  infoRow: { flexDirection: 'row', gap: 8, marginTop: space.md, flexWrap: 'wrap' },
  infoCard: {
    flex: 1, minWidth: '22%', backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, padding: space.md,
    borderRadius: radii.md, gap: 4, alignItems: 'flex-start',
  },
  infoLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  infoValue: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  logRow: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    padding: space.md, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.md,
  },
  logIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  logLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  logText: { color: colors.text, fontFamily: font.body, fontSize: 13, lineHeight: 18, marginTop: 2 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  badge: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    borderColor: 'rgba(16,185,129,0.4)', borderWidth: 1,
  },
  badgeText: { color: colors.success, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  reviewCard: {
    padding: space.md, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.md,
  },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xl,
    backgroundColor: 'rgba(10,10,10,0.95)',
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  actBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: radii.md,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  actBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary, flex: 1.4 },
  actTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: space.md, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: colors.primary, borderWidth: 1,
    marginBottom: space.md,
  },
  pendingDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary,
    marginLeft: 4,
  },
  pendingTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  pendingBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 2 },
  requestEditBtn: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 },
  requestEditTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 },
});

const sadStyles = StyleSheet.create({
  dangerZone: {
    marginTop: space.xl,
    backgroundColor: 'rgba(255,64,90,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,64,90,0.35)',
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.sm,
  },
  dangerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dangerTitle: { color: colors.secondary, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  dangerBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.secondary, paddingVertical: 12, borderRadius: radii.md,
    alignSelf: 'flex-start', paddingHorizontal: 14,
  },
  dangerBtnTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 13 },
  photoMgrCard: {
    marginTop: space.xl,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
    borderRadius: radii.lg,
    padding: space.md,
  },
  photoMgrIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoMgrTitle: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 14 },
  photoMgrSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
});
