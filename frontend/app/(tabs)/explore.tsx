import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  FlatList,
  ActivityIndicator,
  ScrollView,
  Modal,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Search, List, Map as MapIcon, SlidersHorizontal, Locate, X } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import * as Location from 'expo-location';
import { api } from '../../src/api';
import { colors, font, space, radii, QUICK_FILTERS, BEST_TIMES } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { Chip, EmptyState } from '../../src/components/ui';
import { Button } from '../../src/components/Button';

// Native-only map. The require() argument is computed so Metro's static
// analyzer can't trace the package into the web bundle (react-native-maps
// pulls in native-only codegen helpers that crash web bundling).
let MapView: any, Marker: any;
if (Platform.OS !== 'web') {
  try {
    const _load: any = require;
    const maps = _load(['react-native', 'maps'].join('-'));
    MapView = maps.default;
    Marker = maps.Marker;
  } catch {}
}

type Filters = {
  shoot_type?: string;
  best_time_of_day?: string;
  dog_friendly?: boolean;
  kid_friendly?: boolean;
  accessible?: boolean;
  indoor?: boolean;
  permit_required?: boolean;
  fee_required?: boolean;
  min_rating?: number;
};

export default function Explore() {
  const [spots, setSpots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'map' | 'list'>(Platform.OS === 'web' ? 'list' : 'map');
  const [filters, setFilters] = useState<Filters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState<any | null>(null);
  const mapRef = useRef<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 200, sort: 'score' };
      Object.entries(filters).forEach(([k, v]) => {
        if (v != null && v !== '' && v !== false) params[k] = v;
      });
      const data = await api.get('/spots', params);
      setSpots(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filters]); // eslint-disable-line

  const goToCurrent = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        });
      }
    } catch {}
  };

  const filtered = spots;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.searchRow}>
        <TouchableOpacity style={styles.searchBar} onPress={() => router.push('/search')} testID="explore-search">
          <Search size={18} color={colors.textSecondary} />
          <Text style={styles.searchText}>Search location, city, or tag</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setFilterOpen(true)} testID="explore-filters">
          <SlidersHorizontal size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {view === 'map' && Platform.OS !== 'web' && MapView ? (
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={{ latitude: 30.5, longitude: -98.5, latitudeDelta: 3, longitudeDelta: 3 }}
            userInterfaceStyle="dark"
          >
            {filtered.map((s) => (
              s.latitude != null && s.longitude != null && (
                <Marker
                  key={s.spot_id}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  pinColor={s.privacy_mode === 'premium' ? colors.pinPremium : colors.pinPublic}
                  onPress={() => setSelectedSpot(s)}
                  testID={`marker-${s.spot_id}`}
                />
              )
            ))}
          </MapView>

          <View style={styles.floatControls}>
            <TouchableOpacity style={styles.fab} onPress={goToCurrent} testID="explore-locate">
              <Locate size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fab} onPress={() => setView('list')} testID="explore-toggle-list">
              <List size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {selectedSpot && (
            <View style={styles.previewWrap}>
              <TouchableOpacity style={styles.previewClose} onPress={() => setSelectedSpot(null)}>
                <X size={16} color={colors.text} />
              </TouchableOpacity>
              <SpotCard spot={selectedSpot} width={undefined as any} />
            </View>
          )}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : filtered.length === 0 ? (
            <EmptyState title="No spots match" subtitle="Loosen your filters to see more." />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.spot_id}
              contentContainerStyle={{ paddingVertical: space.md, paddingHorizontal: 0, paddingBottom: 100 }}
              ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
              renderItem={({ item }) => (
                <SpotCard spot={item} width={undefined as any} testID={`list-spot-${item.spot_id}`} />
              )}
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

function FilterSheet({
  visible, onClose, filters, onApply,
}: { visible: boolean; onClose: () => void; filters: Filters; onApply: (f: Filters) => void }) {
  const [local, setLocal] = useState<Filters>(filters);
  useEffect(() => setLocal(filters), [filters]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBg}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }} showsVerticalScrollIndicator={false}>
            <View>
              <Text style={styles.sectionLabel}>Shoot type</Text>
              <View style={styles.chipWrap}>
                {['Family', 'Pet', 'Wedding', 'Portrait', 'Seniors', 'Branding', 'Nature', 'Urban'].map((t) => (
                  <Chip
                    key={t}
                    label={t}
                    active={local.shoot_type === t}
                    onPress={() => setLocal({ ...local, shoot_type: local.shoot_type === t ? undefined : t })}
                    testID={`filter-shoot-${t}`}
                  />
                ))}
              </View>
            </View>
            <View>
              <Text style={styles.sectionLabel}>Best time</Text>
              <View style={styles.chipWrap}>
                {BEST_TIMES.map((t) => (
                  <Chip
                    key={t.key}
                    label={t.label}
                    active={local.best_time_of_day === t.key}
                    onPress={() => setLocal({ ...local, best_time_of_day: local.best_time_of_day === t.key ? undefined : t.key })}
                    testID={`filter-time-${t.key}`}
                  />
                ))}
              </View>
            </View>
            <Toggle label="Dog friendly" value={!!local.dog_friendly} onChange={(v) => setLocal({ ...local, dog_friendly: v || undefined })} />
            <Toggle label="Kid friendly" value={!!local.kid_friendly} onChange={(v) => setLocal({ ...local, kid_friendly: v || undefined })} />
            <Toggle label="Accessible" value={!!local.accessible} onChange={(v) => setLocal({ ...local, accessible: v || undefined })} />
            <Toggle label="Indoor" value={!!local.indoor} onChange={(v) => setLocal({ ...local, indoor: v || undefined })} />
            <Toggle label="Permit required" value={!!local.permit_required} onChange={(v) => setLocal({ ...local, permit_required: v || undefined })} />
            <Toggle label="Fee required" value={!!local.fee_required} onChange={(v) => setLocal({ ...local, fee_required: v || undefined })} />

            <View>
              <Text style={styles.sectionLabel}>Min Shoot Score</Text>
              <View style={styles.chipWrap}>
                {[60, 70, 80, 90].map((v) => (
                  <Chip
                    key={v}
                    label={`${v}+`}
                    active={local.min_rating === v}
                    onPress={() => setLocal({ ...local, min_rating: local.min_rating === v ? undefined : v })}
                    testID={`filter-min-${v}`}
                  />
                ))}
              </View>
            </View>
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

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 15 }}>{label}</Text>
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
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    paddingHorizontal: space.lg, paddingVertical: 12, borderRadius: radii.md,
  },
  searchText: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14 },
  iconBtn: {
    width: 44, height: 44, borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  floatControls: {
    position: 'absolute', right: space.xl, bottom: space.xl, gap: 10,
  },
  fab: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(20,20,22,0.85)',
    borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  previewWrap: {
    position: 'absolute',
    left: space.xl, right: space.xl, bottom: space.xxl,
  },
  previewClose: {
    position: 'absolute', right: space.md, top: space.md, zIndex: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surface3,
    alignSelf: 'center', marginTop: 10,
  },
  sheetHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.sm,
  },
  sheetTitle: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  sectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyMedium,
    fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
