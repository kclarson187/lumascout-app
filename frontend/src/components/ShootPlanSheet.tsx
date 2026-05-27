/**
 * ShootPlanSheet — full-height modal for the "Plan This Shoot" feature
 * on every Spot Detail page (Jun 2025).
 *
 * Four sections backed by GET /api/spots/{spot_id}/shoot-plan:
 *   1. Best Time to Arrive  — local-time golden-hour label + duration
 *   2. Light Quality Timeline — horizontal scrollable 24-hr strip
 *   3. Weather Window — compact 5-day forecast (Open-Meteo)
 *   4. Composition Tips — 2-3 short, practical tips
 *   5. Nearby Backup Spots — up to 2 within 10 mi
 *
 * + Save Plan CTA (POST /api/collections/save-shoot-plan) that creates
 * a versioned plan in `shoot_plans` and adds the spot to the user's
 * default "Shoot Plans" collection.
 *
 * Stability rules:
 *   • Fetches plan ONLY when the modal opens (lazy).
 *   • Each section degrades gracefully on missing data (skeleton →
 *     "unavailable" tile → still-functional rest of the plan).
 *   • Never crashes if lat/lng or weather fail — renders fallbacks.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Sun,
  Sunrise,
  CloudRain,
  Wind,
  Compass,
  Sparkles,
  Camera,
  MapPin,
  Bookmark,
  ChevronRight,
  Check,
  AlertCircle,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { api, formatApiError } from '../api';
import { colors, font, space, radii } from '../theme';

// ─────────────────────────────────────────────────────────────────────
// Types (kept loose — backend is the source of truth)
// ─────────────────────────────────────────────────────────────────────

type LightCell = {
  hour: number;
  label: string;
  quality: 'excellent' | 'great' | 'okay' | 'poor';
};

type WeatherDay = {
  date: string;
  weekday: string;
  label: string;
  code: number | null;
  high_f: number | null;
  low_f: number | null;
  rain_chance_pct: number | null;
  wind_mph: number | null;
};

type NearbyBackup = {
  spot_id: string;
  title: string;
  city?: string;
  state?: string;
  category?: string;
  best_time_of_day?: string;
  quality_score?: number;
  distance_mi: number;
  cover_image_url?: string;
};

type ShootPlan = {
  spot_id: string;
  spot_name: string;
  coordinates: { latitude: number; longitude: number } | null;
  best_time_to_arrive: { label: string; iso: string; local_label?: string; duration_min: number } | null;
  light_quality_timeline: LightCell[];
  sun_events: any;
  five_day_weather: WeatherDay[] | null;
  weather_available: boolean;
  composition_tips: string[];
  gear_suggestions: string[];
  nearby_backup_spots: NearbyBackup[];
  generated_at: string;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  spotId: string;
  spotName?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Color mapping for light quality buckets (matches user spec)
// ─────────────────────────────────────────────────────────────────────

const QUALITY_COLORS: Record<LightCell['quality'], string> = {
  excellent: '#F5A623', // gold
  great: '#D88937',     // warm amber
  okay: '#5C5C66',      // muted neutral
  poor: '#2E2E33',      // gray
};

const QUALITY_LABELS: Record<LightCell['quality'], string> = {
  excellent: 'Excellent',
  great: 'Great',
  okay: 'Okay',
  poor: 'Poor',
};

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export default function ShootPlanSheet({ visible, onClose, spotId, spotName }: Props) {
  const [plan, setPlan] = useState<ShootPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Per-session cache by spot_id so toggling the modal doesn't refetch
  // when the user closes & reopens within the same screen view.
  const [cache, setCache] = useState<Record<string, ShootPlan>>({});

  const fetchPlan = useCallback(async () => {
    if (!spotId) return;
    setError(null);
    if (cache[spotId]) {
      setPlan(cache[spotId]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/spots/${spotId}/shoot-plan`);
      setPlan(res);
      setCache((c) => ({ ...c, [spotId]: res }));
    } catch (e) {
      setError(formatApiError(e) || 'Could not load shoot plan');
    } finally {
      setLoading(false);
    }
  }, [spotId, cache]);

  useEffect(() => {
    if (visible) {
      setSavedMessage(null);
      fetchPlan();
    }
  }, [visible, fetchPlan]);

  const handleSave = useCallback(async () => {
    if (!plan || saving) return;
    setSaving(true);
    try {
      const body = {
        spot_id: plan.spot_id,
        spot_name: plan.spot_name,
        latitude: plan.coordinates?.latitude,
        longitude: plan.coordinates?.longitude,
        best_time_to_arrive: plan.best_time_to_arrive,
        light_quality_timeline: plan.light_quality_timeline,
        weather_snapshot: plan.five_day_weather,
        composition_tips: plan.composition_tips,
        gear_suggestions: plan.gear_suggestions,
        backup_spot_ids: (plan.nearby_backup_spots || []).map((b) => b.spot_id),
      };
      const res = await api.post('/collections/save-shoot-plan', body);
      setSavedMessage(res?.message || 'Shoot plan saved to Collections.');
    } catch (e) {
      Alert.alert('Save failed', formatApiError(e) || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [plan, saving]);

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Plan this shoot</Text>
            <Text style={styles.title} numberOfLines={1}>
              {plan?.spot_name || spotName || 'Loading…'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="shoot-plan-close" style={styles.closeBtn}>
            <X size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <PlanSkeleton />
          ) : error ? (
            <ErrorState message={error} onRetry={fetchPlan} />
          ) : !plan ? null : (
            <>
              <BestTimeSection plan={plan} />
              <LightTimelineSection cells={plan.light_quality_timeline} />
              <WeatherSection days={plan.five_day_weather} available={plan.weather_available} />
              <CompositionTipsSection tips={plan.composition_tips} gear={plan.gear_suggestions} />
              <NearbyBackupsSection backups={plan.nearby_backup_spots} onClose={onClose} />
            </>
          )}
        </ScrollView>

        {/* Save plan CTA / saved confirmation */}
        {plan && !loading && !error ? (
          <View style={styles.saveBar}>
            {savedMessage ? (
              <View style={styles.savedRow}>
                <View style={styles.savedDot}>
                  <Check size={14} color={colors.bg} />
                </View>
                <Text style={styles.savedTxt} numberOfLines={2}>{savedMessage}</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                onPress={handleSave}
                disabled={saving}
                testID="shoot-plan-save"
                activeOpacity={0.9}
              >
                {saving ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <>
                    <Bookmark size={18} color={colors.bg} />
                    <Text style={styles.saveBtnTxt}>Save plan</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Best Time to Arrive
// ─────────────────────────────────────────────────────────────────────

function BestTimeSection({ plan }: { plan: ShootPlan }) {
  const best = plan.best_time_to_arrive;
  const sunrise = plan.sun_events?.sunrise_local;
  const sunset = plan.sun_events?.sunset_local;

  if (!plan.coordinates) {
    return (
      <SectionCard>
        <SectionHeader kicker="Best time to arrive" icon={<Sun size={14} color={colors.primary} />} />
        <FallbackTile
          icon={<MapPin size={18} color={colors.textTertiary} />}
          title="Coordinates unavailable"
          subtitle="This spot doesn't have map coordinates yet, so we can't compute sun times."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <SectionHeader kicker="Best time to arrive" icon={<Sun size={14} color={colors.primary} />} />
      <LinearGradient
        colors={['rgba(245,166,35,0.16)', 'rgba(245,166,35,0.04)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.bestTimeCard}
      >
        <View style={styles.bestTimeGlyph}>
          <Sunrise size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bestTimeLabel}>{best?.label || 'Golden hour'}</Text>
          <Text style={styles.bestTimeValue}>{best?.local_label || '—'}</Text>
          {best?.duration_min ? (
            <Text style={styles.bestTimeMeta}>~{best.duration_min} min window of soft, warm light</Text>
          ) : null}
        </View>
      </LinearGradient>

      {(sunrise || sunset) ? (
        <View style={styles.sunRow}>
          {sunrise ? (
            <View style={styles.sunCell}>
              <Sunrise size={12} color={colors.primary} />
              <Text style={styles.sunCellLabel}>Sunrise</Text>
              <Text style={styles.sunCellVal}>{sunrise}</Text>
            </View>
          ) : null}
          {sunset ? (
            <View style={styles.sunCell}>
              <Sun size={12} color={colors.primary} />
              <Text style={styles.sunCellLabel}>Sunset</Text>
              <Text style={styles.sunCellVal}>{sunset}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Light Quality Timeline (horizontal scroll)
// ─────────────────────────────────────────────────────────────────────

function LightTimelineSection({ cells }: { cells: LightCell[] }) {
  if (!cells || cells.length === 0) {
    return (
      <SectionCard>
        <SectionHeader kicker="Light quality timeline" icon={<Sun size={14} color={colors.primary} />} />
        <FallbackTile
          title="Timeline unavailable"
          subtitle="We couldn't compute a light timeline for this location."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <SectionHeader kicker="Light quality timeline" icon={<Sun size={14} color={colors.primary} />} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timelineRow}>
        {cells.map((c) => (
          <View key={c.hour} style={styles.timelineCell}>
            <View
              style={[
                styles.timelineBar,
                {
                  backgroundColor: QUALITY_COLORS[c.quality],
                  // Excellent + great cells get a tiny lift so they read as
                  // the "hot zones" at a glance.
                  height: c.quality === 'excellent' ? 36 : c.quality === 'great' ? 28 : 20,
                },
              ]}
            />
            <Text style={styles.timelineLabel} numberOfLines={1}>{c.label}</Text>
          </View>
        ))}
      </ScrollView>
      {/* Legend */}
      <View style={styles.legendRow}>
        {(['excellent', 'great', 'okay', 'poor'] as const).map((k) => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: QUALITY_COLORS[k] }]} />
            <Text style={styles.legendTxt}>{QUALITY_LABELS[k]}</Text>
          </View>
        ))}
      </View>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: 5-day weather window
// ─────────────────────────────────────────────────────────────────────

function WeatherSection({ days, available }: { days: WeatherDay[] | null; available: boolean }) {
  if (!available || !days || days.length === 0) {
    return (
      <SectionCard>
        <SectionHeader kicker="Weather window" icon={<CloudRain size={14} color={colors.primary} />} />
        <FallbackTile
          icon={<AlertCircle size={18} color={colors.textTertiary} />}
          title="Weather temporarily unavailable"
          subtitle="We couldn't reach the forecast service. The rest of your plan is still ready."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <SectionHeader kicker="Weather window" icon={<CloudRain size={14} color={colors.primary} />} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.weatherRow}
      >
        {days.map((d) => (
          <View key={d.date} style={styles.weatherCard}>
            <Text style={styles.weatherDay}>{d.weekday}</Text>
            <Text style={styles.weatherLabel} numberOfLines={1}>{d.label}</Text>
            <Text style={styles.weatherTemp}>
              {d.high_f != null ? `${d.high_f}°` : '—'}
              <Text style={styles.weatherTempLow}>
                {d.low_f != null ? ` / ${d.low_f}°` : ''}
              </Text>
            </Text>
            <View style={styles.weatherMetaRow}>
              <CloudRain size={10} color={colors.textTertiary} />
              <Text style={styles.weatherMeta}>{d.rain_chance_pct != null ? `${d.rain_chance_pct}%` : '—'}</Text>
            </View>
            <View style={styles.weatherMetaRow}>
              <Wind size={10} color={colors.textTertiary} />
              <Text style={styles.weatherMeta}>{d.wind_mph != null ? `${d.wind_mph} mph` : '—'}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Composition Tips (+ gear hints when available)
// ─────────────────────────────────────────────────────────────────────

function CompositionTipsSection({ tips, gear }: { tips: string[]; gear: string[] }) {
  return (
    <SectionCard>
      <SectionHeader kicker="Composition tips" icon={<Camera size={14} color={colors.primary} />} />
      <View style={{ gap: 10 }}>
        {(tips || []).map((t, i) => (
          <View key={`${i}-${t.slice(0, 16)}`} style={styles.tipRow}>
            <View style={styles.tipBullet}>
              <Sparkles size={11} color={colors.primary} />
            </View>
            <Text style={styles.tipText}>{t}</Text>
          </View>
        ))}
      </View>
      {gear && gear.length > 0 ? (
        <View style={styles.gearWrap}>
          <Text style={styles.gearKicker}>Gear hints</Text>
          <View style={styles.gearRow}>
            {gear.map((g, i) => (
              <View key={`${i}-${g}`} style={styles.gearPill}>
                <Text style={styles.gearPillTxt}>{g}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section: Nearby Backup Spots
// ─────────────────────────────────────────────────────────────────────

function NearbyBackupsSection({
  backups,
  onClose,
}: { backups: NearbyBackup[]; onClose: () => void }) {
  if (!backups || backups.length === 0) {
    return (
      <SectionCard>
        <SectionHeader kicker="Nearby backup spots" icon={<Compass size={14} color={colors.primary} />} />
        <FallbackTile
          icon={<Compass size={18} color={colors.textTertiary} />}
          title="No backup spots found within 10 miles yet"
          subtitle="Add more spots in this area to build your fallback list."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <SectionHeader kicker="Nearby backup spots" icon={<Compass size={14} color={colors.primary} />} />
      <View style={{ gap: 10 }}>
        {backups.map((b) => (
          <TouchableOpacity
            key={b.spot_id}
            activeOpacity={0.9}
            style={styles.backupCard}
            onPress={() => {
              onClose();
              setTimeout(() => router.push(`/spot/${b.spot_id}` as any), 100);
            }}
            testID={`shoot-plan-backup-${b.spot_id}`}
          >
            <View style={styles.backupImageWrap}>
              {b.cover_image_url ? (
                <Image source={{ uri: b.cover_image_url }} style={StyleSheet.absoluteFillObject} />
              ) : (
                <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.surface2 }]} />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.backupTitle} numberOfLines={1}>{b.title}</Text>
              <Text style={styles.backupMeta} numberOfLines={1}>
                {b.distance_mi} mi away
                {b.city ? ` · ${b.city}${b.state ? `, ${b.state}` : ''}` : ''}
              </Text>
              <View style={styles.backupChipsRow}>
                {b.quality_score ? (
                  <View style={styles.backupChip}>
                    <Sparkles size={9} color={colors.primary} />
                    <Text style={styles.backupChipTxt}>Scout {b.quality_score}</Text>
                  </View>
                ) : null}
                {b.best_time_of_day ? (
                  <View style={styles.backupChip}>
                    <Sun size={9} color={colors.primary} />
                    <Text style={styles.backupChipTxt}>{String(b.best_time_of_day).replace('_', ' ')}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <ChevronRight size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Primitives — SectionCard / SectionHeader / FallbackTile / Skeletons
// ─────────────────────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

function SectionHeader({ kicker, icon }: { kicker: string; icon: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIcon}>{icon}</View>
      <Text style={styles.sectionKicker}>{kicker}</Text>
    </View>
  );
}

function FallbackTile({ icon, title, subtitle }: {
  icon?: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.fallbackTile}>
      {icon ? <View style={styles.fallbackIcon}>{icon}</View> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.fallbackTitle}>{title}</Text>
        <Text style={styles.fallbackSub}>{subtitle}</Text>
      </View>
    </View>
  );
}

function PlanSkeleton() {
  return (
    <View style={{ gap: 0 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.section, { opacity: 0.6 }]}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: colors.surface2 }]} />
            <View style={[styles.skelBar, { width: 110 }]} />
          </View>
          <View style={{ gap: 10 }}>
            <View style={[styles.skelBar, { width: '90%', height: 14 }]} />
            <View style={[styles.skelBar, { width: '70%', height: 14 }]} />
            <View style={[styles.skelBar, { width: '85%', height: 14 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={[styles.section, { alignItems: 'center', paddingVertical: 32 }]}>
      <AlertCircle size={28} color={colors.textTertiary} />
      <Text style={[styles.fallbackTitle, { marginTop: 12 }]}>Could not load shoot plan</Text>
      <Text style={[styles.fallbackSub, { textAlign: 'center', marginTop: 4 }]} numberOfLines={3}>{message}</Text>
      <TouchableOpacity onPress={onRetry} style={styles.retryBtn} activeOpacity={0.85}>
        <Text style={styles.retryTxt}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: space.md,
  },
  kicker: {
    color: colors.kicker,
    fontFamily: font.bodySemibold,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 20,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },

  // Section card
  section: {
    marginHorizontal: space.xl,
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  sectionKicker: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 13,
    letterSpacing: 0.1,
  },

  // Best time
  bestTimeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
  },
  bestTimeGlyph: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  bestTimeLabel: { color: colors.kicker, fontFamily: font.bodySemibold, fontSize: 11, letterSpacing: 0.3 },
  bestTimeValue: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3, marginTop: 2 },
  bestTimeMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 4, lineHeight: 16 },
  sunRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  sunCell: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  sunCellLabel: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  sunCellVal: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 12, marginLeft: 'auto' },

  // Timeline
  timelineRow: { gap: 6, paddingVertical: 4 },
  timelineCell: { alignItems: 'center', width: 26 },
  timelineBar: {
    width: 14,
    borderRadius: 4,
    marginBottom: 4,
  },
  timelineLabel: { color: colors.textTertiary, fontFamily: font.body, fontSize: 9 },
  legendRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 10.5 },

  // Weather
  weatherRow: { gap: 10, paddingVertical: 2 },
  weatherCard: {
    width: 96,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  weatherDay: { color: colors.kicker, fontFamily: font.bodySemibold, fontSize: 10, letterSpacing: 0.3 },
  weatherLabel: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  weatherTemp: { color: colors.text, fontFamily: font.bodyBold, fontSize: 18, marginTop: 4 },
  weatherTempLow: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13 },
  weatherMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  weatherMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },

  // Composition tips
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tipBullet: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  tipText: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  gearWrap: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  gearKicker: {
    color: colors.kicker, fontFamily: font.bodySemibold,
    fontSize: 10, letterSpacing: 0.4,
  },
  gearRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gearPill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  gearPillTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 11 },

  // Nearby backups
  backupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  backupImageWrap: {
    width: 62, height: 62, borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  backupTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13.5 },
  backupMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11.5 },
  backupChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  backupChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,166,35,0.28)',
  },
  backupChipTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 9.5 },

  // Fallback tile
  fallbackTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  fallbackIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  fallbackTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  fallbackSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },

  // Skeletons
  skelBar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  // Retry
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
  },
  retryTxt: { color: colors.primary, fontFamily: font.bodySemibold, fontSize: 12 },

  // Save bar
  saveBar: {
    paddingHorizontal: space.xl,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  saveBtnTxt: { color: colors.bg, fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 0.2 },
  savedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.4)',
  },
  savedDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#10B981',
    alignItems: 'center', justifyContent: 'center',
  },
  savedTxt: { flex: 1, color: '#10B981', fontFamily: font.bodySemibold, fontSize: 12.5 },
});
