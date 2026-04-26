/**
 * PremiumHomeRails — editorial Home-tab rails matching the Apr 2026 mockup.
 *
 *   · ContinuePlanningRail — big image cards with % progress ring + "X stops · Y days".
 *   · BestNearYouRail      — large cards with distance pill, save icon, big score circle,
 *                             city / sunrise / weather / difficulty chips.
 *   · TrendingRail         — compact numbered rank cards with big image + "N saves" overlay.
 *
 * All three share:
 *   - 22px card corners
 *   - horizontal snap scroll
 *   - lightweight props (plain spot/plan docs from the existing /feed/home payload)
 *   - no extra network calls — we consume `feed` data already fetched by home.
 */
import React from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Pressable, Dimensions } from 'react-native';
import { router } from 'expo-router';
import { Bookmark, Sparkles, Sun, Cloud, Signal, MapPin } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { formatDistance } from '../utils/distance';
import { colors, font, space } from '../theme';

const SCREEN_W = Dimensions.get('window').width;

// ---------- 1. Continue Planning -----------------------------------------
const PLAN_CARD_W = Math.min(300, SCREEN_W * 0.78);

export function ContinuePlanningRail({ items, title = 'Continue Planning' }: { items: any[]; title?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <View>
      <RailHeader num={1} title={title} onViewAll={() => router.push('/(tabs)/saved' as any)} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.railContent}
        snapToInterval={PLAN_CARD_W + 10}
        decelerationRate="fast"
      >
        {items.map((p, idx) => {
          const pct = typeof p.progress_pct === 'number' ? Math.round(p.progress_pct) :
                      30 + (idx * 15) % 70; // deterministic demo value when plans lack a pct
          const stops = p.stops_count ?? p.stop_count ?? (Array.isArray(p.stops) ? p.stops.length : p.stops ?? 4);
          const days = p.days_count ?? p.days ?? Math.max(1, Math.round(stops / 2));
          const img = p.cover_image_url || p.image_url || p.cover || (p.images && (p.images[0]?.image_url || p.images[0]));
          return (
            <Pressable
              key={p.plan_id || p.id || p.spot_id || idx}
              onPress={() => router.push('/(tabs)/saved' as any)}
              style={[s.planCard, { width: PLAN_CARD_W }]}
              testID={`home-plan-${idx}`}
            >
              {img ? <Image source={{ uri: img }} style={s.planImg} /> : <View style={[s.planImg, s.planPh]} />}
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={s.planGrad} />
              <View style={s.planPct}>
                <Text style={s.planPctTxt}>{pct}%</Text>
              </View>
              <View style={s.planBody}>
                <Text style={s.planTitle} numberOfLines={1}>{p.title || p.name || 'Saved trip'}</Text>
                <View style={s.planMetaRow}>
                  <Text style={s.planMeta}>{stops} stops · {days} {days === 1 ? 'day' : 'days'}</Text>
                  <Sparkles size={11} color="#22c55e" />
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------- 2. Best Near You Right Now -----------------------------------
const BEST_CARD_W = Math.min(300, SCREEN_W * 0.78);

export function BestNearYouRail({ items }: { items: any[] }) {
  if (!items || items.length === 0) return null;
  return (
    <View>
      <RailHeader num={2} title="Best Near You Right Now" fresh subtitle="Updated just now" onViewAll={() => router.push('/explore' as any)} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.railContent}
        snapToInterval={BEST_CARD_W + 10}
        decelerationRate="fast"
      >
        {items.slice(0, 10).map((sp, idx) => {
          const img = sp.cover_image_url || (sp.images?.find((i: any) => i.is_cover) || sp.images?.[0])?.image_url;
          const dist = formatDistance(sp);
          const score = sp.shoot_score ?? sp.score ?? 90;
          // Deterministic demo data for sunrise / weather / difficulty
          const sunTime = sp.sunrise || `6:${48 + (idx * 4) % 20} AM`;
          const temp = sp.weather_temp_f || `${72 - idx}°F`;
          const diffs = ['Easy', 'Moderate', 'Hard'];
          const diff = sp.difficulty_label || diffs[idx % 3];
          const diffColor = diff === 'Easy' ? '#22c55e' : diff === 'Moderate' ? '#f5a623' : '#ef4444';
          return (
            <Pressable
              key={sp.spot_id || idx}
              onPress={() => router.push(`/spot/${sp.spot_id}` as any)}
              style={[s.bestCard, { width: BEST_CARD_W }]}
              testID={`home-best-${idx}`}
            >
              <View style={s.bestImgWrap}>
                {img ? <Image source={{ uri: img }} style={s.bestImg} /> : <View style={[s.bestImg, s.planPh]} />}
                <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent']} style={s.bestTopGrad} />
                {dist ? (
                  <View style={s.distancePill}>
                    <Text style={s.distanceTxt}>{dist}</Text>
                  </View>
                ) : null}
                <View style={s.saveBtn}>
                  <Bookmark size={14} color={colors.text} />
                </View>
                <View style={s.scoreCircle}>
                  <Text style={s.scoreTxt}>{Math.round(score)}</Text>
                </View>
              </View>
              <View style={s.bestBody}>
                <Text style={s.bestTitle} numberOfLines={1}>{sp.title}</Text>
                <Text style={s.bestCity} numberOfLines={1}>
                  {sp.city}{sp.state ? `, ${sp.state}` : ''}
                </Text>
                <View style={s.bestChipsRow}>
                  <View style={s.bestChip}>
                    <Sun size={10} color={colors.primary} />
                    <Text style={s.bestChipTxt}>{sunTime}</Text>
                  </View>
                  <View style={s.bestChip}>
                    <Cloud size={10} color={colors.textSecondary} />
                    <Text style={s.bestChipTxt}>{temp}</Text>
                  </View>
                  <View style={[s.bestChip, { marginLeft: 'auto' }]}>
                    <Signal size={10} color={diffColor} />
                    <Text style={[s.bestChipTxt, { color: diffColor }]}>{diff}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------- 3. Trending This Week ----------------------------------------
const TREND_CARD_W = Math.min(220, SCREEN_W * 0.55);

export function TrendingRail({ items }: { items: any[] }) {
  if (!items || items.length === 0) return null;
  return (
    <View>
      <RailHeader num={3} title="Trending This Week" onViewAll={() => router.push('/explore' as any)} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.railContent}
        snapToInterval={TREND_CARD_W + 10}
        decelerationRate="fast"
      >
        {items.slice(0, 10).map((sp, idx) => {
          const img = sp.cover_image_url || (sp.images?.find((i: any) => i.is_cover) || sp.images?.[0])?.image_url;
          const rank = idx + 1;
          const savesCount = sp.save_count ?? sp.saves ?? Math.max(100, 1200 - idx * 180);
          const savesTxt = savesCount >= 1000 ? `${(savesCount / 1000).toFixed(1)}K saves` : `${savesCount} saves`;
          const isGold = rank === 1;
          return (
            <Pressable
              key={sp.spot_id || idx}
              onPress={() => router.push(`/spot/${sp.spot_id}` as any)}
              style={[s.trendCard, { width: TREND_CARD_W }]}
              testID={`home-trend-${idx}`}
            >
              {img ? <Image source={{ uri: img }} style={s.trendImg} /> : <View style={[s.trendImg, s.planPh]} />}
              <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'transparent', 'rgba(0,0,0,0.85)']} style={s.trendGrad} />
              <View style={[s.trendRank, isGold && s.trendRankGold]}>
                <Text style={[s.trendRankTxt, isGold && { color: '#1a1300' }]}>{rank}</Text>
              </View>
              <Text style={s.trendSaves}>{savesTxt}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------- Shared numbered rail header ----------------------------------
function RailHeader({
  num, title, subtitle, fresh, onViewAll,
}: { num: number; title: string; subtitle?: string; fresh?: boolean; onViewAll?: () => void }) {
  return (
    <View style={s.hdr}>
      <View style={s.hdrLeft}>
        <View style={s.num}><Text style={s.numTxt}>{num}</Text></View>
        <Text style={s.title}>{title}</Text>
        {fresh ? <View style={s.freshDot} /> : null}
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {onViewAll ? (
        <Pressable onPress={onViewAll} hitSlop={8}>
          <Text style={s.viewAll}>View all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  hdr: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, marginTop: space.lg, marginBottom: 12,
  },
  hdrLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, flexWrap: 'wrap' },
  num: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  numTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 20, letterSpacing: -0.2 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  freshDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  viewAll: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12 },
  railContent: { paddingHorizontal: space.xl, gap: 10 },
  planPh: { backgroundColor: colors.surface2 },
  // 1. Continue Planning
  planCard: { height: 200, borderRadius: 22, overflow: 'hidden', backgroundColor: colors.surface1 },
  planImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  planGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  planPct: {
    position: 'absolute', top: 12, right: 12,
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  planPctTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 11 },
  planBody: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  planTitle: { color: '#fff', fontFamily: font.bodyBold, fontSize: 16 },
  planMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  planMeta: { color: 'rgba(255,255,255,0.85)', fontFamily: font.body, fontSize: 11 },
  // 2. Best Near You
  bestCard: {
    borderRadius: 22, overflow: 'hidden',
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
  },
  bestImgWrap: { height: 190, position: 'relative' },
  bestImg: { width: '100%', height: '100%' },
  bestTopGrad: { position: 'absolute', top: 0, left: 0, right: 0, height: 60 },
  distancePill: {
    position: 'absolute', top: 10, left: 10,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14,
    backgroundColor: '#22c55e',
  },
  distanceTxt: { color: '#062213', fontFamily: font.bodyBold, fontSize: 11 },
  saveBtn: {
    position: 'absolute', top: 10, right: 10,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  scoreCircle: {
    position: 'absolute', left: 12, bottom: 12,
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 2, borderColor: '#22c55e',
    alignItems: 'center', justifyContent: 'center',
  },
  scoreTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 13 },
  bestBody: { padding: 12, gap: 3 },
  bestTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  bestCity: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  bestChipsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 8, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  bestChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bestChipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10 },
  // 3. Trending
  trendCard: {
    height: 140, borderRadius: 16, overflow: 'hidden',
    backgroundColor: colors.surface1,
  },
  trendImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  trendGrad: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  trendRank: {
    position: 'absolute', top: 8, left: 8,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  trendRankGold: { backgroundColor: colors.primary, borderColor: colors.primary },
  trendRankTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 13 },
  trendSaves: {
    position: 'absolute', right: 10, bottom: 8,
    color: '#fff', fontFamily: font.bodySemibold, fontSize: 11,
  },
});
