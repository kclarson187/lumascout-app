import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Image,
  Modal,
  Alert,
  TextInput,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { FolderPlus, Bookmark, Lock, X, MapPin, Sparkles, Clock, ChevronRight, Users as UsersIcon, Eye, EyeOff, AlertCircle, RefreshCcw, Compass, Navigation, Sun } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { EmptyState, Chip } from '../../src/components/ui';
import { Button } from '../../src/components/Button';
import UpgradeBanner from '../../src/components/UpgradeBanner';
import ScoutAICard from '../../src/components/ScoutAICard';
import { SpotCardSkeleton } from '../../src/components/Skeleton';
import { BrandedRefreshControl, useBrandedRefresh } from '../../src/theme/refresh';
import useGps from '../../src/hooks/useGps';
import { goldenHourBrief } from '../../src/utils/sun-windows';
import { driveTimeEstimate } from '../../src/utils/drive-time';
// Phase 3 (Jun 2026) — tier-aware soft gating
import { effectiveTier, hasProAccess } from '../../src/utils/entitlements';

type SortKey = 'recent' | 'score' | 'distance' | 'city' | 'shoot_type';
const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recently saved',
  score: 'Shoot score',
  distance: 'Distance',
  city: 'City (A-Z)',
  shoot_type: 'Shoot type',
};

function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * CompactSavedCard — June 2025 Saved redesign.
 * Replaces the large vertical SpotCard for the Favorites list. Layout:
 *   [64×64 thumb]  Name
 *                  City, State
 *                  Golden hour in 42m   · 18 min away
 *                                                        [Directions ↗]
 * - Thumbnail is 1:1 rounded for premium feel.
 * - Whole row tappable → opens spot detail.
 * - Right-side "Directions" tap intercepts and launches the system map app.
 * - Per-card 60s ticker is intentionally NOT used here — instead the
 *   parent screen passes a single shared `tick` so 50+ cards don't each
 *   spawn an interval. Memo'd by spot_id + tick + userCoords presence.
 */
const CompactSavedCard = React.memo(function CompactSavedCard({
  spot,
  userCoords,
  tick,
}: {
  spot: any;
  userCoords?: { lat: number; lng: number } | null;
  tick: number;
}) {
  const lat = spot.latitude;
  const lng = spot.longitude;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const golden = useMemo(
    () => (hasCoords ? goldenHourBrief(lat, lng) : null),
    [lat, lng, tick],
  );
  const drive = useMemo(
    () => driveTimeEstimate(
      userCoords ? { latitude: userCoords.lat, longitude: userCoords.lng } : null,
      hasCoords ? { latitude: lat, longitude: lng } : null,
    ),
    [userCoords?.lat, userCoords?.lng, lat, lng, hasCoords],
  );

  const openDirections = useCallback(() => {
    if (!hasCoords) {
      Alert.alert('Directions unavailable', 'This spot has no precise pin yet.');
      return;
    }
    const label = encodeURIComponent(
      [spot.title, spot.city].filter(Boolean).join(' · ') || 'Spot'
    );
    const iosUrl = `maps://?q=${label}&ll=${lat},${lng}&daddr=${lat},${lng}&dirflg=d`;
    const iosFallback = `http://maps.apple.com/?q=${label}&ll=${lat},${lng}&daddr=${lat},${lng}&dirflg=d`;
    const androidUrl = `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    (async () => {
      try {
        if (Platform.OS === 'ios') {
          const ok = await Linking.canOpenURL(iosUrl).catch(() => false);
          return Linking.openURL(ok ? iosUrl : iosFallback);
        }
        if (Platform.OS === 'android') {
          const ok = await Linking.canOpenURL(androidUrl).catch(() => false);
          return Linking.openURL(ok ? androidUrl : webUrl);
        }
        return Linking.openURL(webUrl);
      } catch {
        Alert.alert('Could not open maps', 'Please try again.');
      }
    })();
  }, [hasCoords, lat, lng, spot.title, spot.city]);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => router.push(`/spot/${spot.spot_id}` as any)}
      style={savedStyles.card}
      testID={`saved-card-${spot.spot_id}`}
    >
      <View style={savedStyles.thumbWrap}>
        {spot.hero_cover_image_url ? (
          <Image source={{ uri: spot.hero_cover_image_url }} style={savedStyles.thumb} />
        ) : (
          <View style={[savedStyles.thumb, { backgroundColor: colors.surface2 }]}>
            <MapPin size={20} color={colors.textTertiary} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={savedStyles.cardTitle} numberOfLines={1}>{spot.title || 'Untitled spot'}</Text>
        <Text style={savedStyles.cardCity} numberOfLines={1}>
          {[spot.city, spot.state].filter(Boolean).join(', ') || '—'}
        </Text>
        <View style={savedStyles.metaRow}>
          {golden ? (
            <View style={savedStyles.metaChunk}>
              <Sun size={10} color={colors.primary} />
              <Text style={savedStyles.metaGold} numberOfLines={1}>{golden}</Text>
            </View>
          ) : null}
          {drive ? (
            <View style={savedStyles.metaChunk}>
              <Clock size={10} color={colors.textSecondary} />
              <Text style={savedStyles.metaDrive} numberOfLines={1}>
                {drive.label.replace(/^Approx\. /, '').replace(/ drive$/, '')} away
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <TouchableOpacity
        onPress={openDirections}
        hitSlop={8}
        style={savedStyles.directionsBtn}
        testID={`saved-directions-${spot.spot_id}`}
      >
        <Navigation size={14} color="#1a1300" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}, (prev, next) =>
  prev.spot.spot_id === next.spot.spot_id &&
  prev.spot.hero_cover_image_url === next.spot.hero_cover_image_url &&
  prev.spot.title === next.spot.title &&
  prev.tick === next.tick &&
  prev.userCoords?.lat === next.userCoords?.lat &&
  prev.userCoords?.lng === next.userCoords?.lng,
);

export default function Saved() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'favorites' | 'collections' | 'private'>('favorites');
  const [savedSpots, setSavedSpots] = useState<any[]>([]);
  const [privateSpots, setPrivateSpots] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [showNewCol, setShowNewCol] = useState(false);
  const [newColName, setNewColName] = useState('');
  // June 2025 — sort + shoot-type filter rails fully removed per redesign
  // CR. Default sort is "Recently saved"; users can re-sort from the
  // overflow menu in a future iteration.
  // Compact saved card needs user GPS + a shared minute ticker so all
  // visible cards re-evaluate countdowns on the same cadence (one
  // setInterval at the screen level, not 50 inside list items).
  const { coords: userCoords } = useGps();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // FIX #2 (Favorites tab skeleton never resolves): Previously the screen
  // had no explicit loading state — a silent API failure would leave the user
  // staring at shimmer cards forever. We now track loading + error + loaded
  // so we can surface skeletons, empty state, OR an actionable error retry.
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setError(null);
    if (!loaded) setLoading(true);
    try {
      const [saves, mine, cols] = await Promise.all([
        api.get('/me/saved'),
        api.get('/me/spots'),
        api.get('/me/collections'),
      ]);
      setSavedSpots(Array.isArray(saves) ? saves : []);
      setPrivateSpots(
        (Array.isArray(mine) ? mine : []).filter(
          (s: any) => s.privacy_mode !== 'public' && s.privacy_mode !== 'premium',
        ),
      );
      setCollections(Array.isArray(cols) ? cols : []);
      setLoaded(true);
    } catch (e) {
      setError(formatApiError(e) || 'Could not load your saves. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [user, loaded]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // CR Item 11 (May 2026) — branded pull-to-refresh hook. The
  // `isChanged` predicate compares the snapshot count of saved spots
  // so we don't fire a "Updated just now" toast when the user pulls
  // and nothing actually changed.
  const pullRefresh = useBrandedRefresh<number>({
    load: async () => {
      setLoaded(false);
      await load();
      return savedSpots.length;
    },
    isChanged: (prev, next) => prev !== null && prev !== next,
  });

  // Favorites — June 2025 simplified: always sort by most-recently saved.
  // The old multi-mode sort (Recently saved / Score / Distance / City /
  // Shoot type) and the shoot-type filter row were removed per redesign
  // CR. Re-introducing them later should reuse this sortedFavs source.
  const sortedFavs = useMemo(() => {
    const arr = [...savedSpots];
    arr.sort((a, b) =>
      new Date(b.saved_at || b.created_at || 0).getTime() -
      new Date(a.saved_at || a.created_at || 0).getTime()
    );
    return arr;
  }, [savedSpots]);

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState
          title="Sign in to save"
          subtitle="Favorite spots, build collections, and keep private locations just for you."
          action={<Button title="Sign in" onPress={() => router.push('/(auth)/login')} />}
        />
      </SafeAreaView>
    );
  }

  const createCollection = async () => {
    if (!newColName.trim()) return;
    try {
      await api.post('/collections', { name: newColName.trim(), privacy_mode: 'private' });
      setNewColName('');
      setShowNewCol(false);
      load();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Saved</Text>
          <Text style={styles.subtitle}>Your favorite places to shoot.</Text>
        </View>
        {user.plan && user.plan !== 'free' ? null : (
          <View style={styles.planPill}><Text style={styles.planPillTxt}>FREE</Text></View>
        )}
      </View>
      {user.plan === 'free' && user.limits && user.usage && (
        <TouchableOpacity onPress={() => router.push('/paywall')} style={styles.usageBanner} testID="saved-usage-banner">
          <Text style={styles.usageTxt}>
            {user.usage.saves}/{user.limits.saves} saves · {user.usage.private_spots}/{user.limits.private_spots} private · {user.usage.collections}/{user.limits.collections} collections
          </Text>
          <Text style={styles.usageCta}>Upgrade →</Text>
        </TouchableOpacity>
      )}
      <View style={styles.tabs}>
        {/* FIX(Commit 6d): pull counts from already-loaded state (no new queries).
            Hide the count when 0 — empty tab just shows the label. */}
        {[
          { k: 'favorites',   l: 'Favorites',   n: savedSpots.length,   icon: <Bookmark size={14} color={tab === 'favorites' ? colors.textInverse : colors.text} /> },
          { k: 'collections', l: 'Collections', n: collections.length,  icon: <FolderPlus size={14} color={tab === 'collections' ? colors.textInverse : colors.text} /> },
          { k: 'private',     l: 'Private',     n: privateSpots.length, icon: <Lock size={14} color={tab === 'private' ? colors.textInverse : colors.text} /> },
        ].map((t) => (
          <TouchableOpacity
            key={t.k}
            testID={`saved-tab-${t.k}`}
            style={[styles.tab, tab === t.k && styles.tabActive]}
            onPress={() => setTab(t.k as any)}
          >
            {t.icon}
            <Text style={[styles.tabText, tab === t.k && { color: colors.textInverse }]}>
              {t.l}{t.n > 0 ? ` (${t.n})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'favorites' && (
        <>
          {loading && !loaded ? (
            // FIX #2: Visible skeleton ONLY during initial fetch. We always
            // follow up with either data, an empty state, or an error UI —
            // never an infinite skeleton.
            <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}>
              <SpotCardSkeleton width={'100%' as any} />
              <SpotCardSkeleton width={'100%' as any} />
              <SpotCardSkeleton width={'100%' as any} />
            </ScrollView>
          ) : error ? (
            <ScrollView contentContainerStyle={{ padding: space.xl }}>
              <View style={styles.errorBox}>
                <AlertCircle size={28} color={colors.secondary} />
                <Text style={styles.errorTitle}>Couldn't load your saves</Text>
                <Text style={styles.errorBody}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={load} testID="favorites-retry">
                  <RefreshCcw size={14} color={colors.textInverse} />
                  <Text style={styles.retryTxt}>Try again</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            <>
              {/* Scout AI planning helper — only shown when user has saved spots to plan from. */}
              {savedSpots.length > 0 && (
                <View style={{ paddingHorizontal: space.xl, marginBottom: 8 }}>
                  <ScoutAICard placement="saved" variant="row" />
                </View>
              )}
              {/* PRD #9 — contextual upsell after user has invested some
                  effort saving favourites. With Free saves now capped at 3,
                  we surface this once they've used 2/3 so they see the
                  Pro pitch right at the moment they're feeling the cap. */}
              {savedSpots.length >= 2 && (user?.plan === 'free' || !user?.plan) && (
                <View style={{ paddingHorizontal: space.xl, marginBottom: 8 }}>
                  <UpgradeBanner
                    placement="saved-favorites"
                    title="You've saved a lot — go Pro to get more out of them"
                    subtitle="Group saves into custom collections, plan unlimited routes, and unlock advanced filters."
                  />
                </View>
              )}
              {savedSpots.length > 0 ? (
                <Text style={styles.countLine} testID="saved-count">
                  {savedSpots.length} saved location{savedSpots.length === 1 ? '' : 's'}
                </Text>
              ) : null}
              {sortedFavs.length === 0 ? (
                <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 100 }}>
                  {/* FIX #2: Richer empty state with illustration + 2 CTAs.
                      Makes it unambiguous that the fetch finished and the user
                      simply hasn't saved anything yet. */}
                  <View style={styles.emptyHero}>
                    <View style={styles.emptyIconWrap}>
                      <Bookmark size={36} color={colors.primary} />
                    </View>
                    <Text style={styles.emptyTitle}>
                      {savedSpots.length === 0 ? 'Nothing saved yet' : 'No matches'}
                    </Text>
                    <Text style={styles.emptyBody}>
                      {savedSpots.length === 0
                        ? 'Tap the bookmark on any spot to keep it here for your next shoot day. Your saves power itineraries, shoot planning, and Scout AI suggestions.'
                        : 'Try clearing the shoot-type filter above.'}
                    </Text>
                    {savedSpots.length === 0 && (
                      <View style={styles.emptyCtaRow}>
                        <TouchableOpacity
                          style={styles.emptyCtaPrimary}
                          onPress={() => router.push('/(tabs)/explore')}
                          testID="favorites-explore-cta"
                        >
                          <Compass size={14} color={colors.textInverse} />
                          <Text style={styles.emptyCtaPrimaryTxt}>Explore spots</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.emptyCtaSecondary}
                          onPress={() => router.push('/scout-ai/planner/collection')}
                          testID="favorites-scoutai-cta"
                        >
                          <Sparkles size={14} color={colors.primary} />
                          <Text style={styles.emptyCtaSecondaryTxt}>Ask Scout AI</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </ScrollView>
              ) : (
                <FlatList
                  data={sortedFavs}
                  keyExtractor={(i) => i.spot_id}
                  contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 100, gap: 10 }}
                  initialNumToRender={6}
                  windowSize={5}
                  removeClippedSubviews
                  renderItem={({ item }) => (
                    <CompactSavedCard
                      spot={item}
                      userCoords={userCoords}
                      tick={tick}
                    />
                  )}
                  // Branded pull-to-refresh.
                  refreshControl={
                    <BrandedRefreshControl
                      refreshing={pullRefresh.refreshing}
                      onRefresh={pullRefresh.onRefresh}
                    />
                  }
                />
              )}
              <pullRefresh.Toast />
            </>
          )}
        </>
      )}

      {tab === 'private' && (
        privateSpots.length === 0 ? (
          <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 100 }}>
            <View style={styles.premiumEmpty}>
              <View style={styles.premiumEmptyIcon}><Lock size={28} color={colors.primary} /></View>
              <Text style={styles.premiumEmptyTitle}>Your private vault</Text>
              <Text style={styles.premiumEmptyBody}>
                Store exact hidden gems, parking pull-offs, overlooked streets, and personal client-only spots.
                Only you can see the exact location — nobody else, not even other LumaScout pros.
              </Text>
              <View style={styles.premiumFeatureList}>
                <FeatureLine icon={<EyeOff size={13} color={colors.primary} />} text="Exact GPS stays off the public map" />
                <FeatureLine icon={<MapPin size={13} color={colors.primary} />} text="Log pull-offs and parking hacks you found" />
                <FeatureLine icon={<UsersIcon size={13} color={colors.primary} />} text="Save client-session addresses securely" />
                <FeatureLine icon={<Sparkles size={13} color={colors.primary} />} text="Add personal notes that never go public" />
              </View>
              <Button title="Add private spot" onPress={() => router.push('/(tabs)/add')} testID="private-add" />
            </View>
          </ScrollView>
        ) : (
          <FlatList
            data={privateSpots}
            keyExtractor={(i) => i.spot_id}
            contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}
            renderItem={({ item }) => <SpotCard spot={item} width={undefined as any} />}
          />
        )
      )}

      {tab === 'collections' && (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}>
          {/* Phase 3 (Jun 2026) — tier-aware Create CTA. Free users see a
              clear "Pro feature" lock with one-tap upgrade route; Pro/Elite
              users see the normal create modal trigger. We use a soft inline
              card instead of an alert so they can browse the rest of the
              page comfortably. */}
          {hasProAccess(user as any) ? (
            <TouchableOpacity style={styles.newColCta} onPress={() => setShowNewCol(true)} testID="saved-new-collection">
              <View style={styles.newColIcon}><FolderPlus size={18} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.newColTitle}>New collection</Text>
                <Text style={styles.newColSub}>Group spots for a shoot day, client trip, or seasonal list.</Text>
              </View>
              <ChevronRight size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.newColLocked}
              onPress={() => router.push('/paywall?reason=collections' as any)}
              testID="saved-new-collection-locked"
            >
              <View style={styles.newColIcon}><Lock size={16} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.newColTitle}>New collection</Text>
                  <View style={styles.proPill}><Text style={styles.proPillTxt}>PRO</Text></View>
                </View>
                <Text style={styles.newColSub}>Custom collections are a Pro feature. Organise spots into themed shoot lists.</Text>
              </View>
              <ChevronRight size={16} color={colors.primary} />
            </TouchableOpacity>
          )}
          {collections.length === 0 ? (
            <EmptyState
              icon={<FolderPlus size={28} color={colors.primary} />}
              title="No collections yet"
              subtitle="Collections are perfect for organising shoots: 'Family sessions · Spring 2026', 'Austin golden hour fields', 'Engagement trip itinerary'."
            />
          ) : (
            collections.map((c) => (
              <TouchableOpacity
                key={c.collection_id}
                style={styles.colCardRich}
                onPress={() => router.push(`/collection/${c.collection_id}`)}
                testID={`collection-${c.collection_id}`}
              >
                {c.cover_image_url
                  ? <Image source={{ uri: c.cover_image_url }} style={styles.colCoverRich} />
                  : <View style={[styles.colCoverRich, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}><FolderPlus size={22} color={colors.textTertiary} /></View>}
                <View style={styles.colOverlay}>
                  <View style={styles.colBadge}>
                    {c.privacy_mode === 'private'
                      ? <><Lock size={10} color={colors.textInverse} /><Text style={styles.colBadgeTxt}>PRIVATE</Text></>
                      : <><Eye size={10} color={colors.textInverse} /><Text style={styles.colBadgeTxt}>{(c.privacy_mode || 'public').toUpperCase()}</Text></>}
                  </View>
                </View>
                <View style={styles.colBody}>
                  <Text style={styles.colTitleRich}>{c.name}</Text>
                  {!!c.description && <Text style={styles.colDescRich} numberOfLines={1}>{c.description}</Text>}
                  <View style={styles.colMetaRow}>
                    <View style={styles.colMetaItem}>
                      <Bookmark size={11} color={colors.textSecondary} />
                      <Text style={styles.colMetaTxt}>{c.count} spot{c.count === 1 ? '' : 's'}</Text>
                    </View>
                    {(c.cities || []).length > 0 && (
                      <View style={styles.colMetaItem}>
                        <MapPin size={11} color={colors.textSecondary} />
                        <Text style={styles.colMetaTxt} numberOfLines={1}>{c.cities.slice(0, 2).join(' · ')}{c.cities.length > 2 ? ` +${c.cities.length - 2}` : ''}</Text>
                      </View>
                    )}
                    <View style={styles.colMetaItem}>
                      <Clock size={11} color={colors.textSecondary} />
                      <Text style={styles.colMetaTxt}>{relativeTime(c.last_updated)}</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      <Modal transparent visible={showNewCol} animationType="fade" onRequestClose={() => setShowNewCol(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 22 }}>New collection</Text>
              <TouchableOpacity onPress={() => setShowNewCol(false)}><X size={20} color={colors.text} /></TouchableOpacity>
            </View>
            <TextInput
              placeholder="Collection name"
              placeholderTextColor={colors.textTertiary}
              value={newColName}
              onChangeText={setNewColName}
              style={styles.input}
              testID="collection-name-input"
              autoFocus
            />
            <Button title="Create" onPress={createCollection} testID="collection-create" />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scoutAiAssist: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    marginTop: space.lg,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(32,130,255,0.35)',
    borderRadius: radii.lg, padding: space.md,
  },
  scoutAiBubble: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(32,130,255,0.12)', borderWidth: 1, borderColor: 'rgba(32,130,255,0.35)',
  },
  scoutAiTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  scoutAiBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 3 },
  root: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 34, letterSpacing: -0.5 },
  // June 2025 — small subtitle under the page title, mirrors the
  // simplified Home tab's hierarchy.
  subtitle: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 13,
    marginTop: 2,
    letterSpacing: 0.1,
  },
  // "24 saved locations" / "1 saved location" — appears above the list.
  countLine: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 12.5,
    paddingHorizontal: space.xl,
    paddingTop: 8,
    paddingBottom: 6,
  },
  planPill: {
    backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: radii.pill, borderColor: colors.border, borderWidth: 1, marginBottom: 6,
  },
  planPillTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  usageBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: space.xl, marginBottom: space.md,
    padding: space.md, backgroundColor: colors.surface1,
    borderColor: colors.primary, borderWidth: 1, borderRadius: radii.md,
  },
  usageTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12, flex: 1 },
  usageCta: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },
  tabs: {
    flexDirection: 'row', paddingHorizontal: space.xl, gap: 8, marginBottom: space.md,
  },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 13 },
  colCard: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.lg, padding: space.md,
  },
  colGrid: { width: 80, height: 80, flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: radii.md, overflow: 'hidden' },
  colThumb: { width: 39, height: 39, borderRadius: 4, backgroundColor: colors.surface2 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  modalCard: { width: '100%', backgroundColor: colors.surface1, borderRadius: radii.lg, padding: space.xl, gap: space.md, borderWidth: 1, borderColor: colors.border },
  input: {
    backgroundColor: colors.surface2, color: colors.text, fontFamily: font.body,
    paddingHorizontal: space.lg, paddingVertical: 14, borderRadius: radii.md, fontSize: 15,
  },
  // Sort / filter rails for Favorites — Apr 2026 polish:
  // Chips were 6px tall, 11px text, low contrast — "cramped + unreadable".
  // Bumped to 36px height, 14px semibold labels, snap-style spacing,
  // higher-contrast text. No clipping on iPhone SE / small Androids.
  sortRail: { paddingVertical: 8 },
  sortChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    minHeight: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sortChipTxt: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 14,
    letterSpacing: 0.1,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    minHeight: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipTxt: {
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 14,
  },
  // New collection CTA row
  newColCta: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: space.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, borderStyle: 'dashed' as any,
  },
  newColIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(245,166,35,0.15)', alignItems: 'center', justifyContent: 'center' },
  newColTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  newColSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
  // Phase 3 (Jun 2026) — locked variant of New Collection for Free users.
  newColLocked: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: space.md, backgroundColor: 'rgba(245,166,35,0.06)',
    borderColor: 'rgba(245,166,35,0.45)', borderWidth: 1, borderRadius: radii.md,
  },
  proPill: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  proPillTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.6 },
  // Rich collection card
  colCardRich: {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.lg, overflow: 'hidden',
  },
  colCoverRich: { width: '100%', aspectRatio: 16 / 7 },
  colOverlay: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6 },
  colBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.7)' },
  colBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  colBody: { padding: space.md, gap: 4 },
  colTitleRich: { color: colors.text, fontFamily: font.display, fontSize: 20, letterSpacing: -0.2 },
  colDescRich: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  colMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' },
  colMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  colMetaTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  // Premium Private empty state
  premiumEmpty: { padding: space.xl, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, alignItems: 'center', gap: space.md },
  premiumEmptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(245,166,35,0.15)', alignItems: 'center', justifyContent: 'center' },
  premiumEmptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 24, letterSpacing: -0.3, textAlign: 'center' },
  premiumEmptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  premiumFeatureList: { alignSelf: 'stretch', gap: 8, backgroundColor: colors.surface2, padding: space.md, borderRadius: radii.md },
  // FIX #2 — Favorites error + empty styles
  errorBox: {
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface1,
    borderColor: 'rgba(208,72,72,0.4)',
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.xl,
  },
  errorTitle: { color: colors.text, fontFamily: font.display, fontSize: 20, letterSpacing: -0.2, marginTop: 4 },
  errorBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryBtn: {
    marginTop: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.pill,
  },
  retryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.3 },
  emptyHero: {
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.xl,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.4)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { color: colors.text, fontFamily: font.display, fontSize: 24, letterSpacing: -0.3, textAlign: 'center' },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 20, textAlign: 'center', paddingHorizontal: 8 },
  emptyCtaRow: { flexDirection: 'row', gap: 10, marginTop: space.md, flexWrap: 'wrap', justifyContent: 'center' },
  emptyCtaPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: radii.pill,
  },
  emptyCtaPrimaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
  emptyCtaSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(245,166,35,0.12)', borderColor: 'rgba(245,166,35,0.4)', borderWidth: 1,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: radii.pill,
  },
  emptyCtaSecondaryTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 },
});

function FeatureLine({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon}
      <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 13, flex: 1 }}>{text}</Text>
    </View>
  );
}


// CompactSavedCard styles — June 2025 Saved redesign.
const savedStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  thumb: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 14.5,
    letterSpacing: -0.1,
  },
  cardCity: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  metaChunk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaGold: {
    color: colors.primary,
    fontFamily: font.bodyMedium,
    fontSize: 11,
  },
  metaDrive: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 11,
  },
  directionsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
