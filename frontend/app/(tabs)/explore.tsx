import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
  FlatList, ActivityIndicator, ScrollView, Modal, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, List, Map as MapIcon, SlidersHorizontal, Locate, X, Shield, Gem, Sun, Users as UsersIcon, MapPin } from 'lucide-react-native';
import * as Location from 'expo-location';
import { api } from '../../src/api';
import { colors, font, space, radii, BEST_TIMES } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { Chip, EmptyState } from '../../src/components/ui';
import { Button } from '../../src/components/Button';
import ScoutAICard from '../../src/components/ScoutAICard';

// Native-only map wrapper with web stub (Metro / codegenNativeCommands safety).
import { MapView, Marker } from '../../src/components/maps-module';

type Filters = {
  shoot_type?: string;
  best_time_of_day?: string;
  best_season?: string;
  dog_friendly?: boolean;
  kid_friendly?: boolean;
  accessible?: boolean;
  indoor?: boolean;
  permit_required?: boolean;
  fee_required?: boolean;
  verified_recently?: boolean;
  hidden_gem?: boolean;
  proven_spot?: boolean;
  min_rating?: number;
  min_parking_ease?: number;
  max_walking_distance?: number;
  max_crowd_level?: number;
  min_sunrise_strength?: number;
  min_sunset_strength?: number;
  min_morning_golden?: number;
  min_evening_golden?: number;
  min_variety?: number;
};

const SHOOT_TYPES = ['Family', 'Pet', 'Wedding', 'Portrait', 'Seniors', 'Branding', 'Nature', 'Urban', 'Travel', 'Lifestyle'];
const SEASONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Explore() {
  const [spots, setSpots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'map' | 'list'>(Platform.OS === 'web' ? 'list' : 'map');
  const [filters, setFilters] = useState<Filters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState<any | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const mapRef = useRef<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 200, sort: 'quality' };
      Object.entries(filters).forEach(([k, v]) => {
        if (v != null && v !== '' && v !== false) params[k] = v;
      });
      const data = await api.get('/spots', params);
      setSpots(data);
    } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  // Refresh when the Explore tab regains focus (e.g., after returning from
  // the Admin Cover Editor or Admin Spot Menu actions).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Request location on mount so the map opens tight and local, not a continent-wide view.
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.status !== 'granted') return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setUserCoords(coords);
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: coords.lat, longitude: coords.lng,
            // Tight urban-scale default — ~25 miles across. Much more useful
            // than the previous 3-degree continent zoom.
            latitudeDelta: 0.45, longitudeDelta: 0.45,
          }, 300);
        }
      } catch {}
    })();
  }, []);

  const goToCurrent = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: loc.coords.latitude, longitude: loc.coords.longitude,
          latitudeDelta: 0.3, longitudeDelta: 0.3,
        }, 400);
      }
    } catch {}
  };

  // Pin color tiering — communicate scouting value at a glance.
  const pinColor = (s: any): string => {
    const verified = s.owner?.verification_status === 'verified';
    const premium = s.privacy_mode === 'premium';
    const proven = (s.shoot_score || 0) >= 80 && (s.images?.length || 0) >= 3;
    if (premium) return '#9D59FF';          // Elite purple
    if (verified && proven) return '#10B981'; // Top-tier green
    if (verified) return colors.primary;     // Verified gold
    if (proven) return '#38BDF8';            // Proven blue
    if ((s.shoot_score || 0) < 60) return '#6B7280'; // Low score gray
    return '#F5A623';                         // Default gold
  };

  const activeCount = Object.values(filters).filter((v) => v != null && v !== false && v !== '').length;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.searchRow}>
        <TouchableOpacity style={styles.searchBar} onPress={() => router.push('/search')} testID="explore-search">
          <Search size={18} color={colors.textSecondary} />
          <Text style={styles.searchText}>Search location, city, or tag</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setFilterOpen(true)} testID="explore-filters">
          <SlidersHorizontal size={18} color={colors.text} />
          {activeCount > 0 && <View style={styles.badgeDot}><Text style={styles.badgeDotTxt}>{activeCount}</Text></View>}
        </TouchableOpacity>
      </View>

      {/* Scout AI — helper row under the search bar (PRD Scout AI Phase 1). */}
      <View style={{ paddingHorizontal: space.xl, paddingBottom: space.sm }}>
        <ScoutAICard placement="explore" variant="row" />
      </View>

      {view === 'map' && Platform.OS !== 'web' && MapView ? (
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={{ latitude: 30.5, longitude: -98.5, latitudeDelta: 0.8, longitudeDelta: 0.8 }}
            userInterfaceStyle="dark"
            showsUserLocation
            showsMyLocationButton={false}
          >
            {spots.map((s) => (
              s.latitude != null && s.longitude != null && (
                <Marker
                  key={s.spot_id}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  pinColor={pinColor(s)}
                  onPress={() => setSelectedSpot(s)}
                  testID={`marker-${s.spot_id}`}
                />
              )
            ))}
          </MapView>

          <View style={styles.legendBar}>
            <LegendDot color="#10B981" label="Verified + Proven" />
            <LegendDot color={colors.primary} label="Verified" />
            <LegendDot color="#38BDF8" label="Proven" />
            <LegendDot color="#9D59FF" label="Elite" />
          </View>

          <View style={styles.floatControls}>
            <TouchableOpacity style={styles.fab} onPress={goToCurrent} testID="explore-locate">
              <Locate size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fab} onPress={() => setView('list')} testID="explore-toggle-list">
              <List size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {selectedSpot && <PinPreview spot={selectedSpot} onClose={() => setSelectedSpot(null)} />}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : spots.length === 0 ? (
            <EmptyState title="No spots match" subtitle="Loosen your filters to see more." />
          ) : (
            <FlatList
              data={spots}
              keyExtractor={(i) => i.spot_id}
              contentContainerStyle={{ paddingVertical: space.md, paddingHorizontal: 12, paddingBottom: 100 }}
              ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => <SpotCard spot={item} testID={`list-spot-${item.spot_id}`} />}
            />
          )}
          {Platform.OS !== 'web' && (
            <TouchableOpacity
              style={[styles.fab, { position: 'absolute', right: space.xl, bottom: space.xl }]}
              onPress={() => setView('map')}
              testID="explore-toggle-map"
            >
              <MapIcon size={18} color={colors.text} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onApply={(f) => { setFilters(f); setFilterOpen(false); }}
      />
    </SafeAreaView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: colors.textInverse, fontFamily: font.bodyMedium, fontSize: 9 }}>{label}</Text>
    </View>
  );
}

function PinPreview({ spot, onClose }: { spot: any; onClose: () => void }) {
  const verified = spot.owner?.verification_status === 'verified';
  const premium = spot.privacy_mode === 'premium';
  return (
    <View style={styles.previewWrap}>
      <TouchableOpacity style={styles.previewClose} onPress={onClose}>
        <X size={16} color={colors.text} />
      </TouchableOpacity>
      <SpotCard spot={spot} width={undefined as any} />
      <View style={styles.previewChipRow}>
        {verified && (
          <View style={[styles.previewChip, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
            <Shield size={10} color="#10B981" />
            <Text style={[styles.previewChipTxt, { color: '#10B981' }]}>Verified</Text>
          </View>
        )}
        {premium && (
          <View style={[styles.previewChip, { backgroundColor: 'rgba(157,89,255,0.15)' }]}>
            <Gem size={10} color="#9D59FF" />
            <Text style={[styles.previewChipTxt, { color: '#9D59FF' }]}>Elite</Text>
          </View>
        )}
        {(spot.morning_golden_hour_rating || 0) >= 4 && (
          <View style={[styles.previewChip, { backgroundColor: 'rgba(245,166,35,0.15)' }]}>
            <Sun size={10} color={colors.primary} />
            <Text style={[styles.previewChipTxt, { color: colors.primary }]}>AM Golden</Text>
          </View>
        )}
        {(spot.evening_golden_hour_rating || 0) >= 4 && (
          <View style={[styles.previewChip, { backgroundColor: 'rgba(245,166,35,0.15)' }]}>
            <Sun size={10} color={colors.primary} />
            <Text style={[styles.previewChipTxt, { color: colors.primary }]}>PM Golden</Text>
          </View>
        )}
        {(spot.crowd_level || 3) <= 2 && (
          <View style={[styles.previewChip, { backgroundColor: 'rgba(96,165,250,0.15)' }]}>
            <UsersIcon size={10} color="#60A5FA" />
            <Text style={[styles.previewChipTxt, { color: '#60A5FA' }]}>Low crowds</Text>
          </View>
        )}
        {spot.distance_mi != null && (
          <View style={[styles.previewChip, { backgroundColor: colors.surface2 }]}>
            <MapPin size={10} color={colors.textSecondary} />
            <Text style={[styles.previewChipTxt, { color: colors.textSecondary }]}>{spot.distance_mi} mi</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function FilterSheet({
  visible, onClose, filters, onApply,
}: { visible: boolean; onClose: () => void; filters: Filters; onApply: (f: Filters) => void }) {
  const [local, setLocal] = useState<Filters>(filters);
  useEffect(() => setLocal(filters), [filters]);

  const setNumber = (k: keyof Filters, v: number) => {
    setLocal((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));
  };
  const toggle = (k: keyof Filters) => setLocal((f) => ({ ...f, [k]: f[k] ? undefined : true }));

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <TouchableOpacity onPress={onClose}><X size={22} color={colors.text} /></TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }} showsVerticalScrollIndicator={false}>
            <Section label="Shoot type">
              {SHOOT_TYPES.map((t) => (
                <Chip key={t} label={t} active={local.shoot_type === t}
                  onPress={() => setLocal({ ...local, shoot_type: local.shoot_type === t ? undefined : t })}
                  testID={`filter-shoot-${t}`} />
              ))}
            </Section>

            <Section label="Best time of day">
              {BEST_TIMES.map((t) => (
                <Chip key={t.key} label={t.label} active={local.best_time_of_day === t.key}
                  onPress={() => setLocal({ ...local, best_time_of_day: local.best_time_of_day === t.key ? undefined : t.key })}
                  testID={`filter-time-${t.key}`} />
              ))}
            </Section>

            <Section label="Best season (month)">
              {SEASONS.map((m) => (
                <Chip key={m} label={m.slice(0, 3)} active={local.best_season === m}
                  onPress={() => setLocal({ ...local, best_season: local.best_season === m ? undefined : m })}
                  testID={`filter-season-${m}`} />
              ))}
            </Section>

            <Section label="Light quality">
              <ScaleChips label="Sunrise ≥" value={local.min_sunrise_strength} onChange={(v) => setNumber('min_sunrise_strength', v)} />
              <ScaleChips label="Sunset ≥" value={local.min_sunset_strength} onChange={(v) => setNumber('min_sunset_strength', v)} />
              <ScaleChips label="AM Golden ≥" value={local.min_morning_golden} onChange={(v) => setNumber('min_morning_golden', v)} />
              <ScaleChips label="PM Golden ≥" value={local.min_evening_golden} onChange={(v) => setNumber('min_evening_golden', v)} />
            </Section>

            <Section label="Access & logistics">
              <ScaleChips label="Min parking ease" value={local.min_parking_ease} onChange={(v) => setNumber('min_parking_ease', v)} />
              <ScaleChips label="Max walking distance" value={local.max_walking_distance} onChange={(v) => setNumber('max_walking_distance', v)} />
              <ScaleChips label="Max crowd level" value={local.max_crowd_level} onChange={(v) => setNumber('max_crowd_level', v)} />
              <ScaleChips label="Background variety ≥" value={local.min_variety} onChange={(v) => setNumber('min_variety', v)} />
            </Section>

            <Section label="Trust & freshness">
              <SwitchRow label="Verified in last 60 days" value={!!local.verified_recently} onChange={() => toggle('verified_recently')} />
              <SwitchRow label="Hidden gem (high score, few saves)" value={!!local.hidden_gem} onChange={() => toggle('hidden_gem')} />
              <SwitchRow label="Proven spot (80+ & 3+ photos)" value={!!local.proven_spot} onChange={() => toggle('proven_spot')} />
            </Section>

            <Section label="Accessibility & rules">
              <SwitchRow label="Dog friendly" value={!!local.dog_friendly} onChange={() => toggle('dog_friendly')} />
              <SwitchRow label="Kid friendly" value={!!local.kid_friendly} onChange={() => toggle('kid_friendly')} />
              <SwitchRow label="Wheelchair accessible" value={!!local.accessible} onChange={() => toggle('accessible')} />
              <SwitchRow label="Indoor option" value={!!local.indoor} onChange={() => toggle('indoor')} />
              <SwitchRow label="Permit required" value={!!local.permit_required} onChange={() => toggle('permit_required')} />
              <SwitchRow label="Fee required" value={!!local.fee_required} onChange={() => toggle('fee_required')} />
            </Section>

            <Section label="Min Shoot Score">
              {[60, 70, 80, 90].map((v) => (
                <Chip key={v} label={`${v}+`} active={local.min_rating === v}
                  onPress={() => setLocal({ ...local, min_rating: local.min_rating === v ? undefined : v })}
                  testID={`filter-min-${v}`} />
              ))}
            </Section>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: space.md, padding: space.xl, paddingTop: 0 }}>
            <Button title="Reset" variant="secondary" onPress={() => setLocal({})} testID="filter-reset" style={{ flex: 1 }} />
            <Button title="Apply filters" onPress={() => onApply(local)} testID="filter-apply" style={{ flex: 2 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: any }) {
  return (
    <View>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

function ScaleChips({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <View style={{ width: '100%', gap: 6, marginTop: 4 }}>
      <Text style={styles.subLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((v) => (
          <TouchableOpacity
            key={v}
            onPress={() => onChange(v)}
            style={[styles.scaleBtn, value === v && styles.scaleBtnActive]}
          >
            <Text style={[styles.scaleTxt, value === v && { color: colors.textInverse }]}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingVertical: 4 }}>
      <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 14, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.surface3 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md,
  },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: space.lg, paddingVertical: 12, borderRadius: radii.md,
  },
  searchText: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14 },
  iconBtn: {
    width: 44, height: 44, borderRadius: radii.md, position: 'relative',
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
  },
  badgeDotTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10 },
  floatControls: { position: 'absolute', right: space.xl, bottom: space.xl, gap: 10 },
  fab: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(20,20,22,0.85)',
    borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  legendBar: {
    position: 'absolute', top: 10, left: space.xl, right: space.xl,
    flexDirection: 'row', gap: 12, flexWrap: 'wrap',
    padding: 8, borderRadius: radii.pill, backgroundColor: 'rgba(15,15,18,0.88)',
    justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  previewWrap: { position: 'absolute', left: space.xl, right: space.xl, bottom: space.xxl },
  previewClose: {
    position: 'absolute', right: space.md, top: space.md, zIndex: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  previewChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  previewChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill },
  previewChipTxt: { fontFamily: font.bodyBold, fontSize: 10 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surface3, alignSelf: 'center', marginTop: 10 },
  sheetHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.sm,
  },
  sheetTitle: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  sectionLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  subLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scaleBtn: { flex: 1, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, alignItems: 'center' },
  scaleBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scaleTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
});
