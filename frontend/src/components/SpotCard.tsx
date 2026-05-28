import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, Platform, Animated, Easing, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Bookmark, Star, Shield, Lock, EyeOff, MapPin, MoreVertical, TrendingUp, Sparkles, ShieldCheck, Compass, Mountain, KeyRound, Info, ShieldAlert } from 'lucide-react-native';
import { formatDistance } from '../utils/distance';
import { goldenHourBrief, blueHourBrief } from '../utils/sun-windows';
import { colors, radii, space, font } from '../theme';
import { api } from '../api';
import { useAuth } from '../auth';
import FreshnessBadge from './FreshnessBadge';
import VerifiedBadge from './VerifiedBadge';
import AdminSpotMenu from './AdminSpotMenu';
import SpotImageFallback from './SpotImageFallback';
import { resolveSpotCoverForListCard } from '../utils/spot-cover';
import { goldenHourLabel as _unusedGoldenHourLabel } from '../utils/sun'; // kept for other consumers; eslint-disable-line

export type Spot = any;

// ─────────────────────────────────────────────────────────────────────
// Jun 2025 — Premium Explore card metadata helpers
// ─────────────────────────────────────────────────────────────────────

/** Format a number with thousands separators (US locale). */
function _formatNum(n: number): string {
  try { return n.toLocaleString('en-US'); } catch { return String(n); }
}

/** Normalize the spot's orientation into a short label.
 *  Backend now returns `orientation_label` directly; we fall back to
 *  legacy field names for older payloads and return `null` when truly
 *  unknown so the caller can render the "Orientation unknown" pill. */
function getOrientationLabel(spot: any): string | null {
  if (!spot || typeof spot !== 'object') return null;
  const direct = spot.orientation_label || spot.orientation || spot.facing_direction || spot.sun_direction || spot.best_light_direction;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  // Last-resort heuristic: sunrise vs sunset rating skew.
  const sr = Number(spot.sunrise_rating || 0);
  const ss = Number(spot.sunset_rating || 0);
  if (sr >= 4 && sr >= ss + 1) return 'Sun faces east · ideal for sunrise';
  if (ss >= 4 && ss >= sr + 1) return 'Sun faces west · ideal for sunset';
  return null;
}

/** Normalize elevation to integer feet. Handles existing feet fields
 *  AND converts meters → feet when needed. Returns null on missing
 *  / malformed values so the caller can render "Elevation unknown". */
function getElevationFt(spot: any): number | null {
  if (!spot) return null;
  const ft = spot.elevation_ft ?? spot.elevationFeet;
  if (typeof ft === 'number' && Number.isFinite(ft)) return Math.round(ft);
  const meters = spot.elevation_m ?? spot.elevation ?? spot.altitude;
  if (typeof meters === 'number' && Number.isFinite(meters) && meters !== 0) {
    return Math.round(meters * 3.28084);
  }
  return null;
}

/** Normalize various server / legacy access fields into one of three
 *  user-facing labels. Defaults to "Private — Check Access" when the
 *  value is missing or unrecognized (trust + safety default). */
function getAccessLabel(spot: any): 'Free Public' | 'Permit Required' | 'Private — Check Access' {
  if (!spot) return 'Private — Check Access';
  const raw = String(
    spot.access_status ?? spot.access ?? spot.access_type ?? spot.accessStatus ?? ''
  ).toLowerCase().trim();
  if (raw === 'free_public' || raw === 'free' || raw === 'public' || raw === 'free public') return 'Free Public';
  if (raw === 'permit_required' || raw === 'permit' || raw === 'requires_permit') return 'Permit Required';
  if (raw === 'private_check' || raw === 'private' || raw === 'restricted') return 'Private — Check Access';
  // Boolean field fallbacks.
  if (spot.permit_required === true) return 'Permit Required';
  if (spot.is_private === true) return 'Private — Check Access';
  if (spot.public_access === true) return 'Free Public';
  if ((spot.privacy_mode || '').toLowerCase() === 'private') return 'Private — Check Access';
  if ((spot.privacy_mode || '').toLowerCase() === 'public') return 'Free Public';
  return 'Private — Check Access';
}

/** Pick up to 3 community sample photo URLs. Order of preference per
 *  the Jun 2025 spec: backend-attached sample_photo_urls →
 *  community_photos → sample_photos → spot.images → photos /
 *  image_urls. Returns `[]` when nothing usable is available. */
function getSamplePhotos(spot: any): string[] {
  if (!spot) return [];
  const pull = (arr: any[]) => {
    const out: string[] = [];
    for (const it of arr || []) {
      if (!it) continue;
      if (typeof it === 'string') { out.push(it); continue; }
      const u = it.thumb_url || it.thumbnail_url || it.small_url || it.preview_url || it.image_url || it.url;
      if (typeof u === 'string' && u) out.push(u);
    }
    return out;
  };
  if (Array.isArray(spot.sample_photo_urls) && spot.sample_photo_urls.length > 0) {
    return spot.sample_photo_urls.filter((u: any) => typeof u === 'string').slice(0, 3);
  }
  for (const key of ['community_photos', 'sample_photos', 'images', 'photos', 'image_urls', 'uploaded_photos']) {
    const cand = pull(spot[key]);
    if (cand.length > 0) return cand.slice(0, 3);
  }
  return [];
}

/** Refreshed Scout-Score badge (Jun 2025) — labeled + tooltip.
 *  Renders "Scout Score: 94" with a small (i) icon. Tap (on mobile) or
 *  hover (on web) shows a tooltip. `stopPropagation` keeps the card's
 *  outer Pressable from intercepting taps on the score itself. */
function ScoreBadge({ score }: { score: number | null | undefined }) {
  const [open, setOpen] = useState(false);
  const valid = typeof score === 'number' && Number.isFinite(score) && score > 0;
  const display = valid ? Math.round(score as number) : null;
  // Color: gold on excellent, secondary on good, blue/info on "New"
  const color = display == null ? colors.info : display >= 80 ? colors.primary : colors.text;
  return (
    <View style={styles.scorePillWrap}>
      <Pressable
        style={[styles.scorePill, { borderColor: color }]}
        // PERF: capture before the card press handler runs so taps on
        // the score don't open the spot detail.
        onPress={(e) => { e.stopPropagation?.(); setOpen((v) => !v); }}
        // Web hover affordance.
        onHoverIn={Platform.OS === 'web' ? () => setOpen(true) : undefined}
        onHoverOut={Platform.OS === 'web' ? () => setOpen(false) : undefined}
        testID="scout-score"
      >
        <Text style={styles.scoreLabel}>Scout Score</Text>
        <Text style={[styles.scoreValueTxt, { color }]}>{display != null ? `: ${display}` : ': New'}</Text>
        <Info size={9} color={colors.textSecondary} style={{ marginLeft: 3 }} />
      </Pressable>
      {open ? (
        <View style={styles.scoreTooltip} pointerEvents="none">
          <Text style={styles.scoreTooltipTxt}>
            Based on light quality, crowd level, and community saves.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Compact horizontal row of metadata pills — orientation, elevation,
 *  access. Renders only when at least one piece of data is meaningful
 *  to avoid empty visual chrome on stripped-down test data.
 */
function ScoutMetaRow({ spot }: { spot: any }) {
  const orientation = getOrientationLabel(spot);
  const elev = getElevationFt(spot);
  const access = getAccessLabel(spot);

  return (
    <View style={styles.scoutMetaRow}>
      {/* Orientation pill — always renders. Falls back to "Orientation
          unknown" when no signal exists. */}
      <View style={styles.metaPill}>
        <Compass size={10} color={colors.primary} />
        <Text style={styles.metaPillTxt} numberOfLines={1}>
          {orientation || 'Orientation unknown'}
        </Text>
      </View>
      <View style={styles.metaPill}>
        <Mountain size={10} color={colors.textSecondary} />
        <Text style={styles.metaPillTxt} numberOfLines={1}>
          {elev != null ? `${_formatNum(elev)} ft` : 'Elevation unknown'}
        </Text>
      </View>
      <View style={[styles.metaPill, accessPillStyle(access)]}>
        {access === 'Free Public' ? <Sparkles size={10} color={colors.success} /> :
         access === 'Permit Required' ? <KeyRound size={10} color={colors.primary} /> :
         <ShieldAlert size={10} color={colors.textSecondary} />}
        <Text style={[styles.metaPillTxt, accessTextStyle(access)]} numberOfLines={1}>
          {access}
        </Text>
      </View>
    </View>
  );
}

function accessPillStyle(label: string) {
  if (label === 'Free Public')      return { borderColor: 'rgba(16,185,129,0.32)', backgroundColor: 'rgba(16,185,129,0.06)' };
  if (label === 'Permit Required')  return { borderColor: 'rgba(245,166,35,0.32)', backgroundColor: 'rgba(245,166,35,0.06)' };
  return {};
}
function accessTextStyle(label: string) {
  if (label === 'Free Public')      return { color: colors.success };
  if (label === 'Permit Required')  return { color: colors.primary };
  return {};
}

/** Bottom-of-card row showing up to 3 community thumbnails. Hides
 *  entirely when no photos exist. Image errors are silently swallowed
 *  per-thumb so a single broken URL never breaks the row. */
function SamplePhotosRow({ urls }: { urls: string[] }) {
  if (!urls || urls.length === 0) return null;
  return (
    <View style={styles.samplePhotoRow}>
      {urls.slice(0, 3).map((u, i) => (
        <SampleThumb key={`${i}-${u}`} url={u} />
      ))}
    </View>
  );
}

function SampleThumb({ url }: { url: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return <View style={[styles.sampleThumb, { backgroundColor: colors.surface2 }]} />;
  }
  return (
    <Image
      source={{ uri: url }}
      style={styles.sampleThumb}
      onError={() => setErr(true)}
      cachePolicy="memory-disk"
      contentFit="cover"
      transition={120}
      recyclingKey={url}
    />
  );
}

function SpotCardImpl({
  spot,
  onPress,
  onToggleSave,
  onAfterAdminAction,
  width,
  testID,
  compact = false,
}: {
  spot: Spot;
  onPress?: () => void;
  onToggleSave?: () => void;
  onAfterAdminAction?: () => void;
  width?: number | string;
  testID?: string;
  /**
   * Compact list-card mode (June 2025 — Explore "All nearby spots").
   * • Shorter image (16:10 instead of 4:5).
   * • No overall-score badge in the image overlay (clutter removal).
   * • Adds a planning row beneath the title showing live golden +
   *   blue-hour countdowns for the spot's coordinates.
   * Non-Explore surfaces (Home rails, search) leave it `false` so
   * they keep their portrait-style premium look.
   */
  compact?: boolean;
}) {
  const { user } = useAuth();
  const isAdmin = !!user && (user.role === 'admin' || user.role === 'super_admin');
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  // #8: track whether the hero image has painted yet so we can fade in
  // and keep a shimmer placeholder until the pixels arrive.
  const [imgLoaded, setImgLoaded] = useState(false);

  // ─── May 2026 (v2.1.1) — image-resize-flash fix ────────────────────
  // Bug: on the Explore list view, cards rendered too LARGE on first
  // paint, then "shrunk" 1–7 s later to the correct card size. Looked
  // unstable / cheap.
  //
  // Root cause:  the imageWrap used `width: '100%' + aspectRatio: 4/5`,
  // which leaves the wrapper unsized in the very first layout pass
  // when the parent ScrollView's content width hasn't been measured
  // yet. RN's layout engine then fell back to satisfying `aspectRatio`
  // against the image's INTRINSIC dimensions — typically ~1200×1500
  // for our R2-hosted JPEGs — so the cell briefly painted at native
  // resolution before the ScrollView's measured width forced a
  // re-layout and the image collapsed to its real card footprint.
  //
  // Fix: compute the card image height in ABSOLUTE PIXELS up-front
  // from the window width minus the page's horizontal gutter
  // (paddingHorizontal: 12 on each side ⇒ 24px gutter). The wrapper
  // now has a concrete pixel height before any measurement happens,
  // so RN never falls back to intrinsic-image sizing.
  //
  // Why it stays correct on rotation / iPad / split view: we recompute
  // the height each render via Dimensions.get('window'). For static
  // phone use that's effectively a constant; for orientation flips
  // the next render picks up the new width and the cards reflow
  // smoothly through React.
  //
  // Why we keep `aspectRatio` as a fallback: when this card is used
  // in horizontally-scrolling lists (Home's "Saved Spots" rail at
  // index.tsx:539 passes `width={260}`), the explicit width prop
  // makes aspectRatio unambiguous on first paint — no flash there.
  // We only override the height when no explicit width is supplied.
  const winWidth = Dimensions.get('window').width;
  // Compact list cards (Explore "All nearby spots", June 2025) use a
  // shorter 16:10 image so 2× more cards fit on one screen and
  // scrolling feels snappier. Default cards stay portrait (4:5).
  const aspect = compact ? 16 / 10 : 4 / 5;
  const fallbackImgHeight = useMemo(() => {
    // Mirror the page gutter from explore.tsx:1469 (paddingHorizontal: 12).
    const gutter = 24;
    const cardWidth = Math.max(280, winWidth - gutter);
    return Math.round(cardWidth / aspect); // height = width / aspect
  }, [winWidth, aspect]);
  const wrapStyle = typeof width === 'number'
    ? [styles.imageWrap, { aspectRatio: aspect }]
    : [styles.imageWrap, { aspectRatio: undefined as unknown as number, height: fallbackImgHeight }];

  // Cover priority (v2.1.0, May 2026): single source of truth via
  // `resolveSpotCoverForListCard(spot)` — same cascade and resize
  // preset as the Map preview and Location Detail so the list
  // thumbnail, pin thumbnail, and detail hero all render the
  // IDENTICAL photo (previously drifted because each surface had
  // its own inline cascade). LIST_CARD preset = 560 px, which is
  // 280pt @ 2x DPR — the right size for feed tiles.
  //
  // CRITICAL FIX (June 2025) — `cover` MUST be declared BEFORE the
  // recycle-flash useEffect below references it in its dependency
  // array. The previous order triggered a Temporal Dead Zone error
  // ("Cannot access 'cover' before initialization") that crashed
  // the entire Explore screen on both iOS and Android, surfaced via
  // ExploreErrorBoundary as the "Explore had a hiccup" fallback.
  const cover = resolveSpotCoverForListCard(spot);
  const isPremium = spot.privacy_mode === 'premium';
  const isHydrated = !!spot?.title;

  // v2.1.0 (May 2026) — image-sizing-flash fix. FlashList recycles
  // cells: when a cell is reused for a different spot, the NEW `cover`
  // URL starts loading but `imgLoaded` is still `true` from the old
  // spot, so the skeleton never re-shows and the PREVIOUS spot's
  // image stays on-screen until expo-image's 160 ms fade finishes.
  // Resetting on every cover change means recycled cells show the
  // shimmer (same neutral tone as the card background) during the
  // swap — no "old image flashing into new image" anymore.
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [cover]);
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);
  const shimmerOpacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });

  const handlePress = () => {
    if (onPress) return onPress();
    // May 2026 stability fix — normalize spot ID with fallbacks so a
    // server response that ever shipped with `id` or `_id` instead of
    // `spot_id` (e.g. paginated wrapper, legacy endpoint, cached
    // payloads) still navigates correctly. We log + bail when nothing
    // resolves so we never call router.push('/spot/undefined').
    const sid = spot?.spot_id || spot?.id || spot?._id;
    if (!sid) {
      try {
        // eslint-disable-next-line no-console
        console.warn('[SpotCard] press w/o id', { keys: spot && Object.keys(spot) });
      } catch {}
      return;
    }
    router.push(`/spot/${sid}`);
  };

  const handleLongPress = () => {
    if (isAdmin) setAdminMenuOpen(true);
  };

  const handleSave = async (e: any) => {
    e?.stopPropagation?.();
    try {
      await api.post(`/spots/${spot.spot_id}/save`);
      onToggleSave?.();
    } catch {}
  };

  // Build discovery badges — max 2 rendered, priority: TRENDING > NEW > FRESH > VERIFIED
  const badges: { kind: string; label: string; color: string; icon: any }[] = [];
  if (spot.is_trending) badges.push({ kind: 'trending', label: 'TRENDING', color: colors.primary, icon: TrendingUp });
  if (spot.is_new) badges.push({ kind: 'new', label: 'NEW', color: colors.success, icon: Sparkles });
  if (spot.is_fresh && !spot.is_new) badges.push({ kind: 'fresh', label: 'FRESH', color: '#3b82f6', icon: Sparkles });
  if (spot.is_verified_discovery) badges.push({ kind: 'verified', label: 'VERIFIED', color: colors.success, icon: ShieldCheck });
  const visibleBadges = badges.slice(0, 2);

  return (
    <>
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={400}
      style={[styles.card, { width: width ?? '100%' }]}
      testID={testID}
    >
      <View style={wrapStyle}>
        {cover && !imgError ? (
          <>
            <Image
              source={cover}
              style={styles.image}
              onError={() => setImgError(true)}
              onLoad={() => setImgLoaded(true)}
              // PERF: hardware-backed disk + memory cache; keeps scrolling
              // butter-smooth and eliminates redundant network fetches.
              cachePolicy="memory-disk"
              contentFit="cover"
              transition={160}
              recyclingKey={cover}
            />
            {!imgLoaded && (
              <Animated.View
                pointerEvents="none"
                style={[styles.skelLayer, { opacity: shimmerOpacity }]}
              />
            )}
          </>
        ) : (
          <SpotImageFallback
            title={spot.title}
            shootType={spot.shoot_types?.[0]}
            seed={spot.spot_id || spot.title}
            style={styles.image}
          />
        )}
        <View style={styles.overlayTop}>
          {isHydrated && isAdmin && (
            <View style={styles.adminChip}>
              <Text style={styles.adminChipTxt}>🛠 ADMIN</Text>
            </View>
          )}
          {isHydrated && isPremium && (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumText}>PREMIUM</Text>
            </View>
          )}
          {isHydrated && spot.privacy_mode === 'private' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(10,10,10,0.8)', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <Lock size={9} color="#fff" />
              <Text style={[styles.premiumText, { color: '#fff' }]}>PRIVATE</Text>
            </View>
          )}
          {isHydrated && spot.privacy_mode === 'followers' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(10,10,10,0.8)' }]}>
              <Text style={[styles.premiumText, { color: '#fff' }]}>FOLLOWERS</Text>
            </View>
          )}
          {isHydrated && spot.location_display_mode === 'approximate' && spot.privacy_mode !== 'private' && (
            <View style={[styles.premiumBadge, { backgroundColor: 'rgba(96,165,250,0.9)', flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
              <MapPin size={9} color="#fff" />
              <Text style={[styles.premiumText, { color: '#fff' }]}>APPROX</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {isHydrated && isAdmin && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); setAdminMenuOpen(true); }}
              style={styles.kebabBtn}
              testID={testID ? `${testID}-admin` : 'spot-admin-menu'}
              hitSlop={6}
            >
              <MoreVertical size={16} color="#fff" />
            </TouchableOpacity>
          )}
          {isHydrated && (
            <TouchableOpacity
              onPress={handleSave}
              style={styles.saveBtn}
              testID={testID ? `${testID}-save` : undefined}
            >
              <Bookmark size={18} color={spot.is_saved ? colors.primary : '#fff'} fill={spot.is_saved ? colors.primary : 'transparent'} />
            </TouchableOpacity>
          )}
        </View>

        {/* Discovery badges — max 2, top of image stacked below the top row */}
        {isHydrated && visibleBadges.length > 0 && (
          <View style={styles.discoveryRow}>
            {visibleBadges.map((b) => {
              const Icon = b.icon;
              return (
                <View key={b.kind} style={[styles.discoveryBadge, { borderColor: b.color, backgroundColor: colorHex(b.color, 0.85) }]}>
                  <Icon size={9} color="#fff" strokeWidth={2.5} />
                  <Text style={styles.discoveryBadgeTxt}>{b.label}</Text>
                </View>
              );
            })}
          </View>
        )}

        {isHydrated && (
          <View style={styles.overlayBottom}>
            {/* BATCH 2 (Apr 2026) — replaced the static 100%-ring +
                "Best at [golden hour]" chips with dynamic metadata so
                Explore cards feel alive and honest. The shoot score
                only shows when it's actually meaningful (< 100). The
                second chip cycles through trending → new check-ins →
                saves count → new — picking the first real signal we
                have. If there's genuinely nothing to say, we say
                nothing (we never fake a value). */}
            {/* Score badge — hidden in compact (Explore list) mode per
                June 2025 CR. Photographers cared more about light +
                drive-time than an aggregate score on this surface.
                Jun 2025 update — ScoreBadge is now labeled
                ("Scout Score: 94") with a tap/hover tooltip. */}
            {!compact && typeof spot.shoot_score === 'number' && spot.shoot_score > 0 && spot.shoot_score < 100 && (
              <ScoreBadge score={spot.shoot_score} />
            )}
            <FreshnessBadge freshness={spot.freshness} label={spot.freshness_label} variant="compact" />
            {(() => {
              // Cascade real signals — first win displays, never multiple.
              if (spot.is_trending) {
                return (
                  <View style={[styles.goldenPill, { backgroundColor: 'rgba(245,166,35,0.9)', borderColor: colors.primary }]}>
                    <Text style={[styles.goldenPillTxt, { color: '#000', fontFamily: font.bodyBold }]} numberOfLines={1}>
                      Trending now
                    </Text>
                  </View>
                );
              }
              const newPosts = Number(spot.recent_upload_count_7d || 0);
              if (newPosts > 0) {
                return (
                  <View style={[styles.goldenPill, { backgroundColor: 'rgba(16,185,129,0.9)', borderColor: colors.success }]}>
                    <Text style={[styles.goldenPillTxt, { color: '#000', fontFamily: font.bodyBold }]} numberOfLines={1}>
                      {newPosts} new {newPosts === 1 ? 'post' : 'posts'}
                    </Text>
                  </View>
                );
              }
              const saves = Number(spot.save_count || 0);
              if (saves >= 3) {
                return (
                  <View style={styles.goldenPill}>
                    <Bookmark size={10} color={colors.primary} fill={colors.primary} />
                    <Text style={styles.goldenPillTxt} numberOfLines={1}>
                      {saves >= 100 ? '99+' : saves} {saves === 1 ? 'save' : 'saves'}
                    </Text>
                  </View>
                );
              }
              if (spot.is_new) {
                return (
                  <View style={[styles.goldenPill, { backgroundColor: 'rgba(96,165,250,0.9)', borderColor: '#60a5fa' }]}>
                    <Text style={[styles.goldenPillTxt, { color: '#000', fontFamily: font.bodyBold }]} numberOfLines={1}>
                      New
                    </Text>
                  </View>
                );
              }
              return null;
            })()}
          </View>
        )}
      </View>

      <View style={[styles.info, compact && styles.infoCompact]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.title, compact && styles.titleCompact, { flex: 1 }]} numberOfLines={1}>{spot.title}</Text>
          <VerifiedBadge status={spot.owner?.verification_status} variant="inline" size={14} />
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.city} numberOfLines={1}>
            {spot.city}, {spot.state}
            {(() => { const d = formatDistance(spot); return d ? ` · ${d}` : ''; })()}
          </Text>
        </View>
        {/* Compact-mode planning row (June 2025 Explore CR) — replaces
            the bigger ScoreBadge with photographer-useful sun timing
            specific to THIS spot's coords. Both lines are computed
            with a 1-minute memo cache (sun-windows.ts) and gracefully
            hide when SunCalc cannot resolve events for this lat/lng
            (e.g. polar regions). */}
        {compact ? <PlanningRow spot={spot} /> : null}

        {/* Jun 2025 — Premium Explore-card photographer metadata.
            Three pills (orientation / elevation / access) + the
            labeled Scout Score with hover/tap tooltip. Always
            rendered (one of them has a graceful-fallback string
            when data is missing). */}
        <ScoutMetaRow spot={spot} />
        <View style={{ marginTop: 4 }}>
          <ScoreBadge score={spot.shoot_score ?? spot.scout_score ?? spot.score ?? spot.quality_score} />
        </View>

        {!compact && (
          <View style={styles.tagRow}>
            {(spot.shoot_types || []).slice(0, 2).map((t: string) => (
              <View key={t} style={styles.tag}>
                <Text style={styles.tagText}>{t}</Text>
              </View>
            ))}
            {spot.average_rating != null && (
              <View style={[styles.tag, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                <Star size={10} color={colors.primary} fill={colors.primary} />
                <Text style={styles.tagText}>{spot.average_rating}</Text>
              </View>
            )}
          </View>
        )}

        {/* Jun 2025 — community sample photo row (max 3 thumbs). Hides
            entirely when there are no images. Broken thumbnails fall
            back to a solid surface tile so the row never crashes. */}
        <SamplePhotosRow urls={getSamplePhotos(spot)} />
      </View>
    </Pressable>
    {isAdmin && (
      <AdminSpotMenu
        visible={adminMenuOpen}
        spot={spot}
        role={user.role}
        onClose={() => setAdminMenuOpen(false)}
        onAfterChange={() => onAfterAdminAction?.()}
      />
    )}
    </>
  );
}

/**
 * PlanningRow — golden + blue hour briefs for compact list cards.
 * Rendered only when the spot has valid lat/lng; gracefully hides
 * when SunCalc cannot resolve events. Re-evaluates every 60 s
 * scoped to the row so unchanged cards don't re-render.
 */
function PlanningRow({ spot }: { spot: any }) {
  const lat = spot?.latitude;
  const lng = spot?.longitude;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (lat == null || lng == null) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [lat, lng]);
  // Tick is a dependency to force re-evaluation each minute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const golden = useMemo(
    () => (lat != null && lng != null ? goldenHourBrief(lat, lng) : null),
    [lat, lng, tick],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blue = useMemo(
    () => (lat != null && lng != null ? blueHourBrief(lat, lng) : null),
    [lat, lng, tick],
  );
  if (lat == null || lng == null) {
    return (
      <View style={styles.planningRow}>
        <Text style={[styles.planningGolden, { color: colors.textTertiary }]} numberOfLines={1}>
          Golden hour unavailable
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.planningRow}>
      <Text style={styles.planningGolden} numberOfLines={1}>
        {golden ?? 'Golden hour unavailable'}
      </Text>
      {blue ? (
        <Text style={styles.planningBlue} numberOfLines={1}>
          {' · '}{blue}
        </Text>
      ) : null}
    </View>
  );
}

function colorHex(hex: string, alpha: number) {
  if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return `rgba(245,166,35,${alpha})`;
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }
      : {
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        }),
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 4 / 5,
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  skelLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface2,
  },
  overlayTop: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    right: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  adminChip: {
    backgroundColor: 'rgba(245,166,35,0.9)',
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.primary,
  },
  adminChipTxt: { color: '#0A0A0A', fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.8 },
  kebabBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  discoveryRow: {
    position: 'absolute',
    top: space.sm + 32,
    left: space.sm,
    flexDirection: 'row', gap: 4, flexWrap: 'wrap',
    maxWidth: '75%',
  },
  discoveryBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  discoveryBadgeTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  overlayBottom: {
    position: 'absolute',
    bottom: space.sm,
    left: space.sm,
    right: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  goldenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(20,16,8,0.78)',
    borderColor: 'rgba(245,166,35,0.55)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  goldenPillTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  premiumBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
  },
  premiumText: {
    color: colors.textInverse,
    fontSize: 9,
    fontFamily: font.bodyBold,
    letterSpacing: 0.5,
  },
  saveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBadge: {
    borderWidth: 2,
    borderColor: colors.success,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,10,0.75)',
  },
  scoreText: {
    fontSize: 12,
    fontFamily: font.bodyBold,
  },
  // ── Jun 2025 — premium Explore card additions ─────────────────────
  // Labeled Scout-Score pill with tap/hover tooltip. Lives inline in
  // the card body (not the corner of the hero image) so the kicker
  // "Scout Score" is always readable.
  scorePillWrap: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  scoreLabel: {
    color: colors.kicker,
    fontSize: 10.5,
    fontFamily: font.bodySemibold,
    letterSpacing: 0.2,
  },
  scoreValueTxt: {
    fontSize: 10.5,
    fontFamily: font.bodyBold,
    letterSpacing: 0.2,
  },
  scoreTooltip: {
    position: 'absolute',
    top: -42,
    left: 0,
    right: 0,
    minWidth: 200,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#0F0F12',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    zIndex: 10,
    // shadow via boxShadow on web; iOS/Android shadows handled below
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 6 },
      default: {},
    }),
  },
  scoreTooltipTxt: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: font.body,
    lineHeight: 14,
  },
  // Meta pill row (orientation, elevation, access)
  scoutMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    maxWidth: '100%',
  },
  metaPillTxt: {
    color: colors.textSecondary,
    fontSize: 10.5,
    fontFamily: font.bodyMedium,
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  // Sample photos row
  samplePhotoRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  sampleThumb: {
    flex: 1,
    aspectRatio: 1.4,
    borderRadius: radii.sm,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  info: {
    padding: space.md,
    gap: 6,
  },
  // Compact-mode info block — tighter padding for the shorter
  // Explore "All nearby" cards. Keeps text legible while shaving
  // ~14 px off card height.
  infoCompact: {
    padding: 10,
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontFamily: font.bodySemibold,
    letterSpacing: -0.2,
  },
  titleCompact: {
    fontSize: 15,
  },
  planningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  planningGolden: {
    color: colors.primary,           // gold accent — matches LumaScout brand
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 0.15,
  },
  planningBlue: {
    color: '#60A5FA',                // soft blue for blue hour
    fontFamily: font.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.15,
  },
  metaRow: { flexDirection: 'row' },
  city: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: font.body,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: {
    backgroundColor: colors.surface2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  tagText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontFamily: font.bodyMedium,
    letterSpacing: 0.4,
  },
});

// PERF: React.memo skips re-renders when props are shallow-equal.
// FlatList/ScrollView of 20–30 SpotCards without memo would re-run each
// card's full body on every parent setState (e.g. unread-notif tick);
// memoization keeps scroll-frame cost flat as the feed grows.
export default memo(SpotCardImpl, (prev, next) => {
  const a = prev.spot, b = next.spot;
  return (
    a?.spot_id === b?.spot_id &&
    a?.hero_cover_image_url === b?.hero_cover_image_url &&
    a?.save_count === b?.save_count &&
    a?.view_count === b?.view_count &&
    a?.verification_status === b?.verification_status &&
    a?.latitude === b?.latitude &&
    a?.longitude === b?.longitude &&
    prev.width === next.width &&
    !!prev.compact === !!next.compact &&
    prev.onToggleSave === next.onToggleSave
  );
});

