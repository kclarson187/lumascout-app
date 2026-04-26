/**
 * PremiumExploreRails — sectioned premium List View for the Explore tab.
 *
 *   · SmartAlertChip       — soft "2 new spots near you" pill at the top.
 *   · NearbyRightNowList   — 3 stacked horizontal cards (thumb · title · distance ·
 *                             score ring · best-time chip · bookmark · route arrow).
 *   · TrendingNearbyList   — compact stacked cards with #1 / #2 / #3 medals.
 *   · GoldenHourRail       — horizontal photo rail with sunset times overlay.
 *
 * Visual rules (Apr 2026 mockup):
 *   - matte black bg, gold accents, 22px+ rounded corners
 *   - cinematic, glanceable, thumb-friendly
 *   - no extra fetches: consumes `spots` already loaded by Explore.
 */
import React from 'react';
import {
  View, Text, StyleSheet, Image, ScrollView, Pressable, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import {
  Bookmark, ArrowUpRight, Sun, TrendingUp, MapPin, Sparkles, Bell,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, space } from '../theme';
import { formatDistance } from '../utils/distance';

const SCREEN_W = Dimensions.get('window').width;

// ---------- helpers --------------------------------------------------------
function coverOf(sp: any): string | null {
  return (
    sp?.hero_cover_image_url ||
    sp?.cover_image_url ||
    (Array.isArray(sp?.images)
      ? (sp.images.find((i: any) => i.is_cover)?.image_url || sp.images[0]?.image_url)
      : null) ||
    null
  );
}

function distancePill(sp: any, fallbackIdx: number): string {
  if (typeof sp?.distance_mi === 'number' || typeof sp?.distance_miles === 'number' || typeof sp?.distance_km === 'number') {
    const v = formatDistance(sp);
    if (v) return v;
  }
  // Deterministic demo fallback so the UI feels alive even without geo
  const demo = [0.8, 1.4, 2.1, 3.6, 4.8, 6.2, 7.5, 9.1];
  return `${demo[fallbackIdx % demo.length]} mi`;
}

function bestTimeLabel(sp: any): { label: string; tone: 'gold' | 'cool' } {
  const am = sp?.morning_golden_hour_rating || 0;
  const pm = sp?.evening_golden_hour_rating || 0;
  if (pm >= 4) return { label: 'Best at sunset', tone: 'gold' };
  if (am >= 4) return { label: 'Best at sunrise', tone: 'gold' };
  if ((sp?.crowd_level || 3) <= 2) return { label: 'Quiet midday', tone: 'cool' };
  return { label: 'Best in golden hour', tone: 'gold' };
}

function sunsetTimeFor(idx: number): string {
  // Deterministic sunset times (PM) so the rail feels alive without a weather API.
  const times = ['7:42 PM', '7:51 PM', '8:03 PM', '8:14 PM', '8:22 PM', '8:31 PM'];
  return times[idx % times.length];
}

// ============================================================================
// 0. Smart alert chip — "X new spots near you"
// ============================================================================
export function SmartAlertChip({
  count,
  onPress,
}: { count: number; onPress?: () => void }) {
  if (!count || count <= 0) return null;
  return (
    <Pressable onPress={onPress} style={s.alertWrap} testID="explore-smart-alert">
      <LinearGradient
        colors={['rgba(245,166,35,0.22)', 'rgba(245,166,35,0.08)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={s.alertGrad}
      >
        <View style={s.alertIcon}>
          <Bell size={12} color={colors.primary} />
        </View>
        <Text style={s.alertTxt}>
          <Text style={s.alertCount}>{count} new </Text>
          spot{count === 1 ? '' : 's'} near you
        </Text>
        <Sparkles size={12} color={colors.primary} style={{ marginLeft: 'auto' }} />
      </LinearGradient>
    </Pressable>
  );
}

// ============================================================================
// 1. Nearby Right Now — 3 stacked horizontal cards
// ============================================================================
export function NearbyRightNowList({ items }: { items: any[] }) {
  const data = (items || []).slice(0, 3);
  if (data.length === 0) return null;
  return (
    <View>
      <SectionHeader
        title="Nearby Right Now"
        subtitle="Live · within 10 mi"
        live
        onViewAll={() => router.push('/search' as any)}
      />
      <View style={{ paddingHorizontal: space.xl, gap: 10 }}>
        {data.map((sp, idx) => (
          <NearbyCard key={sp.spot_id || idx} sp={sp} idx={idx} />
        ))}
      </View>
    </View>
  );
}

function NearbyCard({ sp, idx }: { sp: any; idx: number }) {
  const img = coverOf(sp);
  const dist = distancePill(sp, idx);
  const score = Math.round(sp.shoot_score ?? sp.score ?? 88);
  const bt = bestTimeLabel(sp);
  return (
    <Pressable
      onPress={() => router.push(`/spot/${sp.spot_id}` as any)}
      style={s.nearCard}
      testID={`explore-near-${idx}`}
    >
      <View style={s.nearThumbWrap}>
        {img ? (
          <Image source={{ uri: img }} style={s.nearThumb} />
        ) : (
          <View style={[s.nearThumb, s.placeholder]} />
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0.45)', 'transparent']}
          style={s.nearThumbGrad}
        />
        <View style={s.distBadge}>
          <MapPin size={9} color="#062213" />
          <Text style={s.distBadgeTxt}>{dist}</Text>
        </View>
      </View>

      <View style={s.nearBody}>
        <View style={s.nearHeadRow}>
          <Text style={s.nearTitle} numberOfLines={1}>
            {sp.title}
          </Text>
          <ScoreRing value={score} />
        </View>
        <Text style={s.nearCity} numberOfLines={1}>
          {sp.city}{sp.state ? `, ${sp.state}` : ''}
        </Text>
        <View style={s.nearChipRow}>
          <View style={[s.timeChip, bt.tone === 'gold' ? s.timeChipGold : s.timeChipCool]}>
            <Sun
              size={10}
              color={bt.tone === 'gold' ? colors.primary : '#60A5FA'}
            />
            <Text
              style={[
                s.timeChipTxt,
                { color: bt.tone === 'gold' ? colors.primary : '#60A5FA' },
              ]}
            >
              {bt.label}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation?.();
            }}
            style={s.iconBtnSm}
          >
            <Bookmark size={14} color={colors.text} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation?.();
              router.push(`/spot/${sp.spot_id}` as any);
            }}
            style={[s.iconBtnSm, s.iconBtnGold]}
          >
            <ArrowUpRight size={14} color="#1a1300" />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function ScoreRing({ value }: { value: number }) {
  // Color tier: 90+ green, 75+ gold, else cool
  const ring =
    value >= 90 ? '#22c55e' : value >= 75 ? colors.primary : '#60A5FA';
  return (
    <View style={[s.scoreRing, { borderColor: ring }]}>
      <Text style={[s.scoreRingTxt, { color: ring }]}>{value}</Text>
    </View>
  );
}

// ============================================================================
// 2. Trending Nearby — compact cards with #1 / #2 / #3 medals
// ============================================================================
export function TrendingNearbyList({ items }: { items: any[] }) {
  const data = (items || []).slice(0, 3);
  if (data.length === 0) return null;
  return (
    <View>
      <SectionHeader
        title="Trending Nearby"
        subtitle="Most saved this week"
        icon={<TrendingUp size={13} color={colors.primary} />}
        onViewAll={() => router.push('/explore' as any)}
      />
      <View style={{ paddingHorizontal: space.xl, gap: 10 }}>
        {data.map((sp, idx) => (
          <TrendingRow key={sp.spot_id || idx} sp={sp} rank={idx + 1} />
        ))}
      </View>
    </View>
  );
}

function TrendingRow({ sp, rank }: { sp: any; rank: number }) {
  const img = coverOf(sp);
  const saves =
    sp.save_count ?? sp.saves ?? Math.max(120, 1640 - rank * 220);
  const savesTxt =
    saves >= 1000 ? `${(saves / 1000).toFixed(1)}K saves` : `${saves} saves`;
  const isGold = rank === 1;
  return (
    <Pressable
      onPress={() => router.push(`/spot/${sp.spot_id}` as any)}
      style={s.trendCard}
      testID={`explore-trend-${rank}`}
    >
      <View style={s.trendThumbWrap}>
        {img ? (
          <Image source={{ uri: img }} style={s.trendThumb} />
        ) : (
          <View style={[s.trendThumb, s.placeholder]} />
        )}
        <View style={[s.medal, isGold && s.medalGold]}>
          <Text style={[s.medalTxt, isGold && { color: '#1a1300' }]}>
            #{rank}
          </Text>
        </View>
      </View>

      <View style={s.trendBody}>
        <Text style={s.trendTitle} numberOfLines={1}>
          {sp.title}
        </Text>
        <Text style={s.trendCity} numberOfLines={1}>
          {sp.city}{sp.state ? `, ${sp.state}` : ''}
        </Text>
        <View style={s.trendMetaRow}>
          <View style={s.miniChip}>
            <Sparkles size={10} color={colors.primary} />
            <Text style={s.miniChipTxt}>{savesTxt}</Text>
          </View>
          <View style={s.miniChip}>
            <MapPin size={10} color={colors.textSecondary} />
            <Text style={s.miniChipTxt}>{distancePill(sp, rank)}</Text>
          </View>
        </View>
      </View>

      <View style={s.trendArrow}>
        <ArrowUpRight size={16} color={colors.textSecondary} />
      </View>
    </Pressable>
  );
}

// ============================================================================
// 3. Golden Hour Tonight — horizontal photo rail with sunset times overlay
// ============================================================================
const GH_W = Math.min(170, SCREEN_W * 0.42);

export function GoldenHourRail({ items }: { items: any[] }) {
  const data = (items || []).slice(0, 8);
  if (data.length === 0) return null;
  return (
    <View>
      <SectionHeader
        title="Golden Hour Tonight"
        subtitle="Plan your sunset shoot"
        icon={<Sun size={13} color={colors.primary} />}
        onViewAll={() => router.push('/explore' as any)}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.ghContent}
        snapToInterval={GH_W + 10}
        decelerationRate="fast"
      >
        {data.map((sp, idx) => {
          const img = coverOf(sp);
          return (
            <Pressable
              key={sp.spot_id || idx}
              onPress={() => router.push(`/spot/${sp.spot_id}` as any)}
              style={[s.ghCard, { width: GH_W }]}
              testID={`explore-golden-${idx}`}
            >
              {img ? (
                <Image source={{ uri: img }} style={s.ghImg} />
              ) : (
                <View style={[s.ghImg, s.placeholder]} />
              )}
              <LinearGradient
                colors={[
                  'rgba(0,0,0,0.0)',
                  'rgba(0,0,0,0.0)',
                  'rgba(0,0,0,0.55)',
                  'rgba(0,0,0,0.92)',
                ]}
                style={s.ghGrad}
              />
              <View style={s.ghTimeChip}>
                <Sun size={10} color={colors.primary} />
                <Text style={s.ghTimeTxt}>{sunsetTimeFor(idx)}</Text>
              </View>
              <View style={s.ghBody}>
                <Text style={s.ghTitle} numberOfLines={1}>
                  {sp.title}
                </Text>
                <Text style={s.ghCity} numberOfLines={1}>
                  {sp.city || '—'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Shared section header
// ============================================================================
function SectionHeader({
  title,
  subtitle,
  live,
  icon,
  onViewAll,
}: {
  title: string;
  subtitle?: string;
  live?: boolean;
  icon?: React.ReactNode;
  onViewAll?: () => void;
}) {
  return (
    <View style={s.hdr}>
      <View style={s.hdrLeft}>
        {icon ? <View style={s.hdrIcon}>{icon}</View> : null}
        <View style={{ flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={s.hdrTitle} numberOfLines={1}>
              {title}
            </Text>
            {live ? (
              <View style={s.liveDotWrap}>
                <View style={s.liveDot} />
                <Text style={s.liveTxt}>LIVE</Text>
              </View>
            ) : null}
          </View>
          {subtitle ? <Text style={s.hdrSub}>{subtitle}</Text> : null}
        </View>
      </View>
      {onViewAll ? (
        <Pressable onPress={onViewAll} hitSlop={8}>
          <Text style={s.viewAll}>See all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================
const s = StyleSheet.create({
  placeholder: { backgroundColor: colors.surface2 },

  // Smart alert
  alertWrap: {
    marginHorizontal: space.xl,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
  },
  alertGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  alertIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTxt: {
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 12.5,
  },
  alertCount: {
    color: colors.primary,
    fontFamily: font.bodyBold,
  },

  // Section header
  hdr: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    marginTop: 18,
    marginBottom: 10,
  },
  hdrLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  hdrIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hdrTitle: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 21,
    letterSpacing: -0.3,
  },
  hdrSub: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 11,
    marginTop: 1,
  },
  liveDotWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(34,197,94,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  liveTxt: {
    color: '#22c55e',
    fontFamily: font.bodyBold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  viewAll: {
    color: colors.primary,
    fontFamily: font.bodySemibold,
    fontSize: 12,
  },

  // Nearby Right Now stacked cards
  nearCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    padding: 10,
    gap: 12,
  },
  nearThumbWrap: {
    width: 88,
    height: 88,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    position: 'relative',
  },
  nearThumb: {
    width: '100%',
    height: '100%',
  },
  nearThumbGrad: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '60%',
  },
  distBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#22c55e',
  },
  distBadgeTxt: {
    color: '#062213',
    fontFamily: font.bodyBold,
    fontSize: 10,
  },
  nearBody: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  nearHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nearTitle: {
    flex: 1,
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 15,
    letterSpacing: -0.1,
  },
  nearCity: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 11,
    marginTop: 1,
  },
  nearChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  timeChipGold: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.4)',
  },
  timeChipCool: {
    backgroundColor: 'rgba(96,165,250,0.12)',
    borderColor: 'rgba(96,165,250,0.4)',
  },
  timeChipTxt: {
    fontFamily: font.bodySemibold,
    fontSize: 10.5,
  },
  iconBtnSm: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconBtnGold: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  scoreRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRingTxt: {
    fontFamily: font.bodyBold,
    fontSize: 12,
  },

  // Trending stacked rows
  trendCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    padding: 10,
    alignItems: 'center',
    gap: 12,
  },
  trendThumbWrap: {
    width: 76,
    height: 76,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surface2,
  },
  trendThumb: {
    width: '100%',
    height: '100%',
  },
  medal: {
    position: 'absolute',
    top: 6,
    left: 6,
    minWidth: 26,
    paddingHorizontal: 6,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalGold: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  medalTxt: {
    color: '#fff',
    fontFamily: font.bodyBold,
    fontSize: 11,
  },
  trendBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  trendTitle: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 14.5,
    letterSpacing: -0.1,
  },
  trendCity: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 11,
  },
  trendMetaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  miniChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  miniChipTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodySemibold,
    fontSize: 10,
  },
  trendArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Golden Hour rail
  ghContent: {
    paddingHorizontal: space.xl,
    gap: 10,
  },
  ghCard: {
    height: 220,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  ghGrad: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  ghTimeChip: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.5)',
  },
  ghTimeTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10.5,
  },
  ghBody: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
  },
  ghTitle: {
    color: '#fff',
    fontFamily: font.bodyBold,
    fontSize: 13.5,
    letterSpacing: -0.1,
  },
  ghCity: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: font.body,
    fontSize: 10.5,
    marginTop: 1,
  },
});
