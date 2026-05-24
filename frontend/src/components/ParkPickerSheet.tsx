/**
 * ParkPickerSheet — Phase 2 of the Park-Based Multi-Spot Workflow.
 *
 * A full-screen modal that lets a user:
 *   1. Search existing parent parks (debounced /api/parks/search)
 *   2. Tap one to use it as the current spot's parent
 *   3. Or — if none match — create a new park inline with the spot's
 *      current pin pre-filled. The backend returns 409 with `matches[]`
 *      if a near-identical park exists; we surface that as an
 *      "Is this the same park?" inline prompt with one-tap re-use or
 *      explicit "Create new park anyway".
 *
 * Onboarding parity: works the same way for the "Continue adding spots
 * to <park>" session-pickup flow — they share the same selection
 * callback.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  Alert,
} from 'react-native';
import { X, Search, MapPin, Plus, AlertTriangle, Check } from 'lucide-react-native';
import { api, formatApiError } from '../api';
import { colors, font, space, radii } from '../theme';

export type ParkSummary = {
  park_id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country_code?: string | null;
  latitude: number;
  longitude: number;
  child_spot_count?: number;
  _distance_km?: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (park: ParkSummary) => void;
  /** Spot draft coords used to bias search & pre-fill create form. */
  nearLat?: number | null;
  nearLng?: number | null;
  /** Pre-fill the create form fields if we already know them from the draft. */
  defaultCity?: string;
  defaultState?: string;
  defaultCountryCode?: string;
  /** Suggested initial query (e.g. landmark text already entered). */
  initialQuery?: string;
};

export default function ParkPickerSheet({
  visible, onClose, onPick,
  nearLat, nearLng,
  defaultCity, defaultState, defaultCountryCode,
  initialQuery,
}: Props) {
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ParkSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<any>(null);

  // Create-form state
  const [cName, setCName] = useState('');
  const [cAddress, setCAddress] = useState('');
  const [cCity, setCCity] = useState('');
  const [cState, setCState] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [dupMatches, setDupMatches] = useState<ParkSummary[] | null>(null);

  // Reset on open/close
  useEffect(() => {
    if (visible) {
      setMode('search');
      setQ(initialQuery || '');
      setResults([]);
      setSearched(false);
      setCName(initialQuery || '');
      setCAddress('');
      setCCity(defaultCity || '');
      setCState(defaultState || '');
      setCreateErr(null);
      setDupMatches(null);
    }
  }, [visible, initialQuery, defaultCity, defaultState]);

  // Debounced search
  useEffect(() => {
    if (!visible || mode !== 'search') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.trim().length < 2) {
      // Default: surface nearby parks even without a query
      if (typeof nearLat === 'number' && typeof nearLng === 'number') {
        setLoading(true);
        api.get('/parks/search', { near_lat: nearLat, near_lng: nearLng, radius_km: 20, limit: 15 })
          .then((r) => { setResults(Array.isArray(r) ? r : []); setSearched(true); })
          .catch(() => setResults([]))
          .finally(() => setLoading(false));
      } else {
        setResults([]);
        setSearched(false);
      }
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const params: any = { q: q.trim(), limit: 20 };
        if (typeof nearLat === 'number' && typeof nearLng === 'number') {
          params.near_lat = nearLat;
          params.near_lng = nearLng;
          params.radius_km = 50;
        }
        const r = await api.get('/parks/search', params);
        setResults(Array.isArray(r) ? r : []);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [q, visible, mode, nearLat, nearLng]);

  const onSelect = (p: ParkSummary) => {
    onPick(p);
    onClose();
  };

  const onSwitchToCreate = () => {
    setCName(q.trim() || '');
    setCAddress('');
    setCCity(defaultCity || '');
    setCState(defaultState || '');
    setCreateErr(null);
    setDupMatches(null);
    setMode('create');
  };

  const onCreate = async (forceCreate = false) => {
    setCreateErr(null);
    if (cName.trim().length < 2) {
      setCreateErr('Please enter the park name (at least 2 characters).');
      return;
    }
    if (typeof nearLat !== 'number' || typeof nearLng !== 'number') {
      setCreateErr('Set a pin on your spot first so we can anchor the park.');
      return;
    }
    setCreating(true);
    try {
      const body: any = {
        name: cName.trim(),
        address: cAddress.trim() || undefined,
        city: cCity.trim() || undefined,
        state: cState.trim() || undefined,
        country_code: defaultCountryCode || undefined,
        latitude: nearLat,
        longitude: nearLng,
        force_create: forceCreate,
      };
      const r = await api.post('/parks', body);
      onPick(r as ParkSummary);
      onClose();
    } catch (e: any) {
      // 409 → duplicate candidate prompt
      const status = e?.status || e?.response?.status;
      const detail = e?.body?.detail || e?.detail;
      if (status === 409 && detail && Array.isArray(detail.matches)) {
        setDupMatches(detail.matches);
        setCreateErr(null);
      } else {
        setCreateErr(formatApiError(e) || 'Could not create park.');
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn} testID="park-picker-close">
            <X size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {mode === 'search' ? 'Select a park / area' : 'Create a new park'}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {mode === 'search' ? (
          <View style={{ flex: 1 }}>
            <View style={styles.searchWrap}>
              <Search size={16} color={colors.textTertiary} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search by park or area name…"
                placeholderTextColor={colors.textTertiary}
                style={styles.searchInput}
                autoFocus
                returnKeyType="search"
                testID="park-picker-q"
              />
              {q.length > 0 && (
                <TouchableOpacity onPress={() => setQ('')} hitSlop={8}>
                  <X size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>

            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
            ) : (
              <FlatList
                data={results}
                keyExtractor={(p) => p.park_id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: space.lg, paddingBottom: 220, gap: 8 }}
                ListHeaderComponent={results.length > 0 && q.trim().length < 2 ? (
                  <Text style={styles.hint}>Parks near your pin</Text>
                ) : null}
                ListEmptyComponent={
                  <View style={{ paddingHorizontal: space.lg, paddingTop: 12, gap: 14 }}>
                    {q.trim().length >= 2 && searched ? (
                      <Text style={styles.noMatches}>No parks match "{q.trim()}".</Text>
                    ) : (
                      <Text style={styles.hint}>
                        Type to search, or create a new park if it doesn't exist yet.
                      </Text>
                    )}
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.row}
                    activeOpacity={0.7}
                    onPress={() => onSelect(item)}
                    testID={`park-picker-row-${item.park_id}`}
                  >
                    <View style={styles.rowIcon}>
                      <MapPin size={16} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {item.city ? `${item.city}` : ''}{item.state ? `, ${item.state}` : ''}
                        {typeof item._distance_km === 'number' ? ` · ${item._distance_km.toFixed(1)} km away` : ''}
                      </Text>
                    </View>
                    {typeof item.child_spot_count === 'number' && item.child_spot_count > 0 && (
                      <View style={styles.countPill}>
                        <Text style={styles.countPillTxt}>{item.child_spot_count}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}

            <View style={styles.footer}>
              <TouchableOpacity style={styles.createBtn} onPress={onSwitchToCreate} testID="park-picker-create-new">
                <Plus size={16} color={colors.textInverse} />
                <Text style={styles.createBtnTxt}>Create a new park</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ padding: space.lg, gap: 12 }}>
              <Text style={styles.label}>Park / area name *</Text>
              <TextInput
                value={cName}
                onChangeText={(v) => { setCName(v); setDupMatches(null); }}
                placeholder="e.g. Eisenhower Park"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                testID="park-create-name"
              />
              <Text style={styles.label}>Address (optional)</Text>
              <TextInput
                value={cAddress}
                onChangeText={setCAddress}
                placeholder="19399 NW Military Hwy"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                testID="park-create-address"
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.label}>City</Text>
                  <TextInput
                    value={cCity}
                    onChangeText={setCCity}
                    placeholder="San Antonio"
                    placeholderTextColor={colors.textTertiary}
                    style={styles.input}
                    testID="park-create-city"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>State</Text>
                  <TextInput
                    value={cState}
                    onChangeText={setCState}
                    placeholder="TX"
                    autoCapitalize="characters"
                    maxLength={3}
                    placeholderTextColor={colors.textTertiary}
                    style={styles.input}
                    testID="park-create-state"
                  />
                </View>
              </View>

              <Text style={styles.metaNote}>
                The park's center pin will be anchored to your current spot location.
                Individual child spots will keep their own exact pins.
              </Text>

              {createErr && (
                <View style={styles.errBox}>
                  <AlertTriangle size={13} color={colors.secondary} />
                  <Text style={styles.errTxt}>{createErr}</Text>
                </View>
              )}

              {dupMatches && dupMatches.length > 0 && (
                <View style={styles.dupBox}>
                  <Text style={styles.dupTitle}>Is this the same park?</Text>
                  <Text style={styles.dupSub}>
                    We found {dupMatches.length} similar park{dupMatches.length > 1 ? 's' : ''} nearby:
                  </Text>
                  {dupMatches.slice(0, 3).map((m) => (
                    <TouchableOpacity
                      key={m.park_id}
                      style={styles.dupRow}
                      onPress={() => onSelect(m)}
                      testID={`park-dup-${m.park_id}`}
                    >
                      <Check size={14} color={colors.success} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{m.name}</Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {m.city || ''}{m.state ? `, ${m.state}` : ''}
                          {typeof m._distance_km === 'number' ? ` · ${m._distance_km.toFixed(2)} km away` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={styles.dupForceBtn}
                    onPress={() => onCreate(true)}
                    disabled={creating}
                    testID="park-create-force"
                  >
                    <Text style={styles.dupForceTxt}>Create new park anyway</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.backBtn]}
                onPress={() => setMode('search')}
                disabled={creating}
                testID="park-create-back"
              >
                <Text style={styles.backBtnTxt}>Back to search</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, creating && { opacity: 0.5 }]}
                onPress={() => onCreate(false)}
                disabled={creating || cName.trim().length < 2}
                testID="park-create-submit"
              >
                {creating ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <>
                    <Plus size={16} color={colors.textInverse} />
                    <Text style={styles.createBtnTxt}>Create park</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  headerBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontFamily: font.display, fontSize: 18 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: space.lg, marginTop: 12,
    padding: 11, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 14 },
  hint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 12, marginBottom: 4 },
  noMatches: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  rowMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 1 },
  countPill: {
    minWidth: 22, paddingHorizontal: 6, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(245,166,35,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  countPillTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11 },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: space.lg, gap: 8,
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  createBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  createBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  backBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  backBtnTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },

  // Create form
  label: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
  input: {
    padding: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    color: colors.text, fontFamily: font.body, fontSize: 14,
  },
  metaNote: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, lineHeight: 16, marginTop: 4 },

  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: radii.md,
    backgroundColor: 'rgba(208,72,72,0.10)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(208,72,72,0.35)',
  },
  errTxt: { color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 12, flex: 1 },

  dupBox: {
    padding: 12, borderRadius: radii.md, gap: 6,
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(251,191,36,0.45)',
  },
  dupTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  dupSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginBottom: 6 },
  dupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 8, borderRadius: radii.sm,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  dupForceBtn: {
    marginTop: 6, paddingVertical: 10, alignItems: 'center', borderRadius: radii.sm,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  dupForceTxt: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 13 },
});
