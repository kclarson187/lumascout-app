/**
 * WeatherSection.tsx — Premium tier-aware Weather card (Jun 2026)
 * ═══════════════════════════════════════════════════════════════
 *
 * Drop-in component for the Location Detail page and the public Share
 * Location page. Fetches /api/weather (or /api/public/shared/{token}/
 * weather when a token is provided) and renders a tier-aware card:
 *
 *   • Free / anon: current weather hero + locked card teasers
 *                  ("Unlock hourly forecasts with Pro")
 *   • Pro:         current + 24-hour hourly strip + 5-day daily strip
 *                  + locked Elite teasers
 *   • Elite:       current + hourly + 10-day daily + alerts (if any) +
 *                  minute-precip pill + "Elite Weather Planning"
 *
 * Design intent:
 *   - dark-mode-first, cinematic
 *   - never shows broken cards; loading skeleton + error fallback handled
 *   - the backend is the source of truth for tier — we render whatever
 *     `available_features` says is present, and show `locked_features`
 *     as upgrade teasers
 *   - one-handed-friendly: horizontal scrollable hourly/daily strips
 *
 * Props:
 *   lat / lng    — when present, fetches from /api/weather (auth aware)
 *   shareToken   — when present, fetches from /api/public/shared/{token}/
 *                  weather instead (tier comes from sharer, not viewer)
 *   onUpgrade?   — optional callback when user taps an upgrade CTA;
 *                  defaults to routing to /paywall.
 *   compact?     — render a smaller single-row variant (for previews)
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CloudSun, Sun, Cloud, CloudRain, CloudSnow, CloudFog,
  Wind, Droplets, Sunrise, Sunset, Lock, TriangleAlert as AlertTriangle,
  Sparkles, Eye, ChevronRight,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { colors, font } from '../theme';
import { api } from '../api';
import { useAuth } from '../auth';
import { effectiveTier, isAdmin } from '../utils/entitlements';

// ─── Types ────────────────────────────────────────────────────────────
export interface WeatherCurrent {
  temp_f?: number; temp_c?: number;
  feels_like_f?: number;
  condition_code?: string; label?: string; sf_symbol?: string;
  precip_chance_pct?: number;
  wind_mph?: number; wind_dir_deg?: number;
  humidity_pct?: number;
  cloud_cover_pct?: number;
  visibility_mi?: number; visibility_km?: number;
  uv_index?: number;
  is_daylight?: boolean;
  as_of?: string;
}
export interface WeatherHourly {
  time?: string;
  temp_f?: number;
  label?: string; sf_symbol?: string;
  precip_chance_pct?: number;
  wind_mph?: number;
  cloud_cover_pct?: number;
}
export interface WeatherDaily {
  date?: string;
  high_f?: number; low_f?: number;
  label?: string; sf_symbol?: string;
  precip_chance_pct?: number;
  sunrise?: string; sunset?: string;
}
export interface WeatherAlert {
  id?: string;
  event?: string; description?: string;
  severity?: string; certainty?: string; urgency?: string;
  source?: string;
  onset?: string; expires?: string;
  url?: string;
}
export interface WeatherMinuteForecast {
  summary?: string;
  starts_in_min?: number | null;
  minutes?: Array<{ time?: string; intensity_mm_h?: number; chance_pct?: number }>;
}
export interface WeatherPayload {
  ok?: boolean;
  source?: 'weatherkit' | 'open_meteo' | 'none';
  tier?: 'anon' | 'free' | 'pro' | 'elite';
  available_features?: string[];
  locked_features?: string[];
  upgrade_target?: 'pro' | 'elite' | null;
  current?: WeatherCurrent | null;
  hourly?: WeatherHourly[] | null;
  daily?: WeatherDaily[] | null;
  alerts?: WeatherAlert[] | null;
  minute_forecast?: WeatherMinuteForecast | null;
  photoPlanning?: any;
  attribution_url?: string;
  as_of?: string;
  cached?: boolean;
  // Public-share-only meta
  as_shared_by_tier?: 'free' | 'pro' | 'elite';
  spot_name?: string;
}

// ─── Component ────────────────────────────────────────────────────────
interface Props {
  lat?: number | null;
  lng?: number | null;
  shareToken?: string;
  onUpgrade?: () => void;
  compact?: boolean;
}

export default function WeatherSection({
  lat, lng, shareToken, onUpgrade, compact,
}: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<WeatherPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errored, setErrored] = useState<boolean>(false);

  // Client-side expected tier (for parity-checking the backend response).
  // We TRUST the backend's `data.tier` for rendering — this value is only
  // used to detect mismatches during debugging.
  const expectedTier = useMemo(() => effectiveTier(user), [user]);

  const fetchKey = useMemo(() => {
    if (shareToken) return `share:${shareToken}`;
    if (typeof lat === 'number' && typeof lng === 'number') {
      return `coord:${lat.toFixed(3)},${lng.toFixed(3)}`;
    }
    return '';
  }, [shareToken, lat, lng]);

  useEffect(() => {
    let cancelled = false;
    if (!fetchKey) { setLoading(false); return; }
    setLoading(true); setErrored(false);
    (async () => {
      try {
        const json: WeatherPayload = shareToken
          ? await api.get(`/public/shared/${encodeURIComponent(shareToken)}/weather`)
          : await api.get('/weather', { lat, lng });
        if (!cancelled) {
          setData(json);

          // ─── Tier-mismatch debug logging ───────────────────────
          // Logs in dev mode or for admins on real builds, so we can
          // catch entitlement-resolution bugs early. Skipped on the
          // public-share weather endpoint (sharer's tier ≠ viewer's).
          if (!shareToken && (__DEV__ || isAdmin(user))) {
            const serverTier = json?.tier;
            const mismatch = serverTier && serverTier !== expectedTier;
            // eslint-disable-next-line no-console
            console.log('[WeatherSection] tier resolution', {
              user_id: user?.user_id,
              email: user?.email,
              role: user?.role,
              raw_plan: user?.plan,
              expected_tier_client: expectedTier,
              tier_from_server: serverTier,
              upgrade_target: json?.upgrade_target,
              mismatch,
              available_features: json?.available_features,
            });
            if (mismatch) {
              // eslint-disable-next-line no-console
              console.warn(
                `[WeatherSection] TIER MISMATCH — client expected "${expectedTier}" ` +
                `but server returned "${serverTier}". Inspect ` +
                `/api/weather/_debug_tier to see which fields fired.`,
              );
            }
          }
        }
      } catch (_e) {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchKey, lat, lng, shareToken]);

  const handleUpgrade = useCallback(() => {
    if (onUpgrade) { onUpgrade(); return; }
    try { router.push('/paywall' as any); } catch { /* no-op */ }
  }, [onUpgrade, router]);

  // ─── Loading / error / empty states (never broken cards) ──────────
  if (!fetchKey) {
    return null;  // No coords — caller didn't pass usable data; render nothing.
  }
  if (loading) {
    return (
      <View style={styles.card} testID="weather-loading">
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>Reading the sky…</Text>
      </View>
    );
  }
  if (errored || !data || data.ok === false || !data.current) {
    return (
      <View style={styles.card} testID="weather-unavailable">
        <View style={styles.headerRow}>
          <CloudFog size={18} color={colors.muted} />
          <Text style={styles.headerTitle}>Shoot Weather</Text>
        </View>
        <Text style={styles.errorText}>
          Weather data is unavailable for this spot right now.
        </Text>
      </View>
    );
  }

  const tier = data.tier || 'anon';
  const available = new Set(data.available_features || []);
  const locked = new Set(data.locked_features || []);
  const current = data.current as WeatherCurrent;
  const hourly = (data.hourly || []).slice(0, 24);
  const daily = (data.daily || []).slice(0, tier === 'elite' ? 10 : 5);
  const alerts = data.alerts || [];

  return (
    <View style={styles.card} testID="weather-card">
      {/* Severe weather alert banner — Elite only, but renders first if present */}
      {tier === 'elite' && alerts.length > 0 && (
        <View style={styles.alertBanner} testID="weather-alert-banner">
          <AlertTriangle size={16} color="#ff7043" />
          <Text style={styles.alertText} numberOfLines={2}>
            {alerts[0].event || alerts[0].description || 'Active weather alert'}
            {alerts[0].severity ? `  ·  ${alerts[0].severity}` : ''}
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.headerRow}>
        <CloudSun size={18} color={colors.primary} />
        <Text style={styles.headerTitle}>Shoot Weather</Text>
        {tier === 'elite' ? (
          <View style={[styles.tierPill, styles.tierPillElite]}>
            <Sparkles size={11} color="#1a1a1a" />
            <Text style={styles.tierPillTextElite}>Elite</Text>
          </View>
        ) : tier === 'pro' ? (
          <View style={[styles.tierPill, styles.tierPillPro]}>
            <Text style={styles.tierPillTextPro}>Pro</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.subHeader}>
        Plan this spot around light, wind, clouds, and rain.
      </Text>

      {/* Current condition hero row */}
      <View style={styles.heroRow}>
        {renderConditionIcon(current.sf_symbol, current.label, 44)}
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.heroTemp}>
            {Math.round(current.temp_f ?? 0)}°F
            {typeof current.feels_like_f === 'number' && (
              <Text style={styles.heroFeels}>  · feels {Math.round(current.feels_like_f)}°</Text>
            )}
          </Text>
          <Text style={styles.heroLabel} numberOfLines={1}>
            {current.label || 'Conditions'}
          </Text>
        </View>
      </View>

      {/* Quick stats strip */}
      <View style={styles.statsRow}>
        {typeof current.wind_mph === 'number' && (
          <Stat icon={<Wind size={14} color={colors.muted} />}
                label={`${Math.round(current.wind_mph)} mph`} />
        )}
        {typeof current.precip_chance_pct === 'number' && (
          <Stat icon={<Droplets size={14} color={colors.muted} />}
                label={`${Math.round(current.precip_chance_pct)}%`} />
        )}
        {typeof current.cloud_cover_pct === 'number' && (
          <Stat icon={<Cloud size={14} color={colors.muted} />}
                label={`${Math.round(current.cloud_cover_pct)}% cl`} />
        )}
        {typeof current.visibility_mi === 'number' && current.visibility_mi >= 0 && current.visibility_mi <= 300 && (
          <Stat icon={<Eye size={14} color={colors.muted} />}
                label={`${Math.round(current.visibility_mi)} mi`} />
        )}
      </View>

      {/* Sunrise / Sunset row (always shown when daily has it) */}
      {daily[0]?.sunrise && daily[0]?.sunset && (
        <View style={styles.sunRow}>
          <View style={styles.sunCell}>
            <Sunrise size={14} color="#ffb86b" />
            <Text style={styles.sunText}>{formatLocalTime(daily[0].sunrise)}</Text>
          </View>
          <View style={styles.sunCell}>
            <Sunset size={14} color="#ff7043" />
            <Text style={styles.sunText}>{formatLocalTime(daily[0].sunset)}</Text>
          </View>
        </View>
      )}

      {compact && (
        // In compact mode (e.g. inline embeds), stop here.
        renderAttribution(data)
      )}

      {!compact && (
        <>
          {/* Hourly strip — Pro+Elite */}
          {available.has('hourly') && hourly.length > 0 ? (
            <View style={{ marginTop: 18 }} testID="weather-hourly">
              <Text style={styles.sectionLabel}>Next 24 hours</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ paddingRight: 12 }}>
                {hourly.map((h, i) => (
                  <View key={`h${i}`} style={styles.hourCell}>
                    <Text style={styles.hourTime}>{formatLocalHour(h.time)}</Text>
                    {renderConditionIcon(h.sf_symbol, h.label, 18)}
                    <Text style={styles.hourTemp}>{Math.round(h.temp_f ?? 0)}°</Text>
                    {typeof h.precip_chance_pct === 'number' && h.precip_chance_pct >= 5 && (
                      <Text style={styles.hourRain}>{Math.round(h.precip_chance_pct)}%</Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : locked.has('hourly') ? (
            <LockedCard
              title="24-hour hourly forecast"
              copy="Unlock hourly forecasts with Pro — plan around sun, weather, and shoot conditions."
              target="pro"
              onUpgrade={handleUpgrade}
              testID="weather-locked-hourly"
            />
          ) : null}

          {/* Daily strip */}
          {available.has('daily') && daily.length > 0 ? (
            <View style={{ marginTop: 18 }} testID="weather-daily">
              <Text style={styles.sectionLabel}>
                {tier === 'elite' ? 'Next 10 days' : 'Next 5 days'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ paddingRight: 12 }}>
                {daily.map((d, i) => (
                  <View key={`d${i}`} style={styles.dayCell}>
                    <Text style={styles.dayName}>{formatDayName(d.date, i === 0)}</Text>
                    {renderConditionIcon(d.sf_symbol, d.label, 18)}
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      <Text style={styles.dayHi}>{Math.round(d.high_f ?? 0)}°</Text>
                      <Text style={styles.dayLo}>{Math.round(d.low_f ?? 0)}°</Text>
                    </View>
                    {typeof d.precip_chance_pct === 'number' && d.precip_chance_pct >= 5 && (
                      <Text style={styles.hourRain}>{Math.round(d.precip_chance_pct)}%</Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : locked.has('daily') ? (
            <LockedCard
              title="5-day forecast"
              copy="Pro photographers plan a week ahead. See the next 5 days at a glance."
              target="pro"
              onUpgrade={handleUpgrade}
              testID="weather-locked-daily"
            />
          ) : null}

          {/* Elite teasers — show only for Pro who is missing them, never for Elite */}
          {tier === 'pro' && (
            <View style={{ marginTop: 18 }} testID="weather-elite-teasers">
              <Text style={styles.sectionLabel}>Elite unlocks</Text>
              <View style={styles.eliteTeaserRow}>
                {locked.has('ten_day_forecast') && (
                  <EliteChip icon={<Sun size={14} color="#ffd699" />} label="10-day forecast" />
                )}
                {locked.has('severe_weather_alerts') && (
                  <EliteChip icon={<AlertTriangle size={14} color="#ff7043" />} label="Severe alerts" />
                )}
                {locked.has('minute_precipitation') && (
                  <EliteChip icon={<CloudRain size={14} color="#7eb8ff" />} label="Minute-by-minute" />
                )}
                {locked.has('sun_path_planning') && (
                  <EliteChip icon={<Sunrise size={14} color="#ffb86b" />} label="Sun-path planning" />
                )}
                {locked.has('best_time_to_shoot_48h') && (
                  <EliteChip icon={<Sparkles size={14} color="#bb86fc" />} label="48h shoot windows" />
                )}
              </View>
              <TouchableOpacity onPress={handleUpgrade} style={styles.upgradeBtn}
                                activeOpacity={0.85} testID="weather-upgrade-elite">
                <LinearGradient
                  colors={['rgba(187,134,252,0.20)', 'rgba(187,134,252,0.04)']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={styles.upgradeBtnInner}
                >
                  <Text style={styles.upgradeBtnText}>
                    Upgrade to Elite for advanced shoot planning
                  </Text>
                  <ChevronRight size={16} color={colors.primary} />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* Free → Pro upgrade prompt */}
          {(tier === 'anon' || tier === 'free') && (
            <TouchableOpacity onPress={handleUpgrade} style={styles.upgradeBtn}
                              activeOpacity={0.85} testID="weather-upgrade-pro">
              <LinearGradient
                colors={['rgba(245,166,35,0.22)', 'rgba(245,166,35,0.04)']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.upgradeBtnInner}
              >
                <Text style={styles.upgradeBtnText}>
                  Upgrade to Pro for hourly + 5-day forecasts
                </Text>
                <ChevronRight size={16} color={colors.primary} />
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Share-page sharer tier badge */}
          {data.as_shared_by_tier === 'pro' && (
            <Text style={styles.sharerBadge}>Weather included with Pro</Text>
          )}
          {data.as_shared_by_tier === 'elite' && (
            <Text style={[styles.sharerBadge, { color: '#ffd699' }]}>
              Elite Weather Planning Included
            </Text>
          )}

          {renderAttribution(data)}
        </>
      )}
    </View>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────
function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.statCell}>
      {icon}
      <Text style={styles.statText}>{label}</Text>
    </View>
  );
}

function EliteChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.eliteChip}>
      {icon}
      <Text style={styles.eliteChipText}>{label}</Text>
    </View>
  );
}

function LockedCard({
  title, copy, target, onUpgrade, testID,
}: { title: string; copy: string; target: 'pro' | 'elite'; onUpgrade: () => void; testID?: string }) {
  return (
    <TouchableOpacity onPress={onUpgrade} activeOpacity={0.85}
                      style={styles.lockedCard} testID={testID}>
      <View style={styles.lockedHeader}>
        <Lock size={14} color={colors.muted} />
        <Text style={styles.lockedTitle}>{title}</Text>
      </View>
      <Text style={styles.lockedCopy}>{copy}</Text>
      <Text style={styles.lockedCta}>
        Upgrade to {target === 'elite' ? 'Elite' : 'Pro'} →
      </Text>
    </TouchableOpacity>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────
function renderConditionIcon(symbol: string | undefined, label: string | undefined, size: number) {
  // Cheap SF-Symbol → Lucide icon mapping. Falls back to CloudSun.
  const sym = (symbol || '').toLowerCase();
  const lbl = (label || '').toLowerCase();
  const color = '#e8edf2';
  if (sym.includes('sun.max') || lbl.includes('clear')) return <Sun size={size} color={color} />;
  if (sym.includes('rain') || sym.includes('drizzle') || lbl.includes('rain') || lbl.includes('shower')) {
    return <CloudRain size={size} color={color} />;
  }
  if (sym.includes('snow') || sym.includes('flurries') || lbl.includes('snow')) {
    return <CloudSnow size={size} color={color} />;
  }
  if (sym.includes('fog') || sym.includes('haze') || lbl.includes('fog')) {
    return <CloudFog size={size} color={color} />;
  }
  if (sym.includes('cloud.sun') || lbl.includes('partly')) {
    return <CloudSun size={size} color={color} />;
  }
  if (sym.includes('cloud') || lbl.includes('cloudy') || lbl.includes('overcast')) {
    return <Cloud size={size} color={color} />;
  }
  return <CloudSun size={size} color={color} />;
}

function renderAttribution(data: WeatherPayload) {
  if (!data.attribution_url) return null;
  const label = data.source === 'weatherkit' ? ' Weather' : 'Weather data';
  return <Text style={styles.attrib}>{label}</Text>;
}

function formatLocalTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

function formatLocalHour(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: 'numeric' }).replace(/:00 /, ' ');
  } catch { return ''; }
}

function formatDayName(iso?: string, isToday?: boolean): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isToday) return 'Today';
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  } catch { return ''; }
}

// ─── Styles ───────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(28,30,36,0.92)',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: {
    flex: 1, color: '#e8edf2',
    fontFamily: font.bodySemibold, fontSize: 15,
    letterSpacing: 0.2,
  },
  subHeader: {
    color: '#9aa3ad',
    fontFamily: font.body, fontSize: 12,
    marginTop: 4, marginBottom: 14,
  },
  tierPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10,
  },
  tierPillPro: { backgroundColor: 'rgba(245,166,35,0.22)' },
  tierPillElite: { backgroundColor: '#ffd699' },
  tierPillTextPro: { color: '#ffb86b', fontFamily: font.bodySemibold, fontSize: 10 },
  tierPillTextElite: { color: '#1a1a1a', fontFamily: font.bodySemibold, fontSize: 10 },
  heroRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  heroTemp: { color: '#e8edf2', fontFamily: font.bodySemibold, fontSize: 28 },
  heroFeels: { color: '#9aa3ad', fontFamily: font.body, fontSize: 13 },
  heroLabel: { color: '#bcc4cd', fontFamily: font.body, fontSize: 13, marginTop: 2 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  statCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: '#bcc4cd', fontFamily: font.body, fontSize: 12 },
  sunRow: {
    flexDirection: 'row', gap: 16,
    marginTop: 12, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  sunCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sunText: { color: '#bcc4cd', fontFamily: font.body, fontSize: 12 },
  sectionLabel: {
    color: '#9aa3ad',
    fontFamily: font.bodySemibold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  hourCell: {
    alignItems: 'center',
    width: 52,
    paddingVertical: 8,
    marginRight: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    gap: 4,
  },
  hourTime: { color: '#9aa3ad', fontFamily: font.body, fontSize: 11 },
  hourTemp: { color: '#e8edf2', fontFamily: font.bodySemibold, fontSize: 13 },
  hourRain: { color: '#7eb8ff', fontFamily: font.body, fontSize: 10 },
  dayCell: {
    alignItems: 'center',
    width: 62,
    paddingVertical: 10,
    marginRight: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    gap: 6,
  },
  dayName: { color: '#bcc4cd', fontFamily: font.bodySemibold, fontSize: 11 },
  dayHi: { color: '#e8edf2', fontFamily: font.bodySemibold, fontSize: 13 },
  dayLo: { color: '#7c848d', fontFamily: font.body, fontSize: 13 },
  lockedCard: {
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 12,
    gap: 6,
  },
  lockedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lockedTitle: { color: '#bcc4cd', fontFamily: font.bodySemibold, fontSize: 13 },
  lockedCopy: { color: '#9aa3ad', fontFamily: font.body, fontSize: 12 },
  lockedCta: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12, marginTop: 4 },
  eliteTeaserRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eliteChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 12,
  },
  eliteChipText: { color: '#bcc4cd', fontFamily: font.body, fontSize: 12 },
  upgradeBtn: { marginTop: 14 },
  upgradeBtnInner: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  upgradeBtnText: { flex: 1, color: '#e8edf2', fontFamily: font.bodySemibold, fontSize: 13 },
  sharerBadge: {
    color: '#ffb86b',
    fontFamily: font.bodySemibold, fontSize: 11,
    textAlign: 'center',
    marginTop: 14,
    letterSpacing: 0.5,
  },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,112,67,0.12)',
    borderColor: 'rgba(255,112,67,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10, marginBottom: 12,
  },
  alertText: { flex: 1, color: '#ffb098', fontFamily: font.bodySemibold, fontSize: 12 },
  loadingText: { color: '#9aa3ad', fontFamily: font.body, fontSize: 12, marginTop: 8, textAlign: 'center' },
  errorText: { color: '#9aa3ad', fontFamily: font.body, fontSize: 12, marginTop: 8 },
  attrib: { color: '#6b727a', fontFamily: font.body, fontSize: 10, marginTop: 14, textAlign: 'right' },
});
