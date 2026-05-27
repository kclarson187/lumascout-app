import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { X, Search, MapPin, Plus } from 'lucide-react-native';
import { api } from '../api';
import { colors, font, space, radii } from '../theme';

export type PlaceResult = {
  place_id: string;
  display_name: string;
  latitude: number | null;
  longitude: number | null;
  name: string;
  city: string;
  state: string;
  country: string;
  postcode?: string;
  type?: string;
  confidence?: number;
};

/**
 * Full-screen autocomplete search sheet for locations.
 * Debounced Nominatim lookup via `/api/geocode/search`. Shows "Enter manually"
 * fallback when no results come back.
 */
export default function LocationSearchSheet({
  visible,
  onClose,
  onPick,
  onManualEntry }: {
  visible: boolean;
  onClose: () => void;
  onPick: (place: PlaceResult) => void;
  onManualEntry?: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [debouncing, setDebouncing] = useState(false);
  // Batch #7 — surface graceful-fallback + timeout state to the user so a
  // geocoder hiccup doesn't leave the sheet looking broken. If the backend
  // returns `{degraded:true}` (see /api/geocode/search graceful wrapper)
  // OR we never get a response, we drop into a "temporarily unavailable"
  // state that still lets the user drop a pin manually.
  const [degraded, setDegraded] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => {
    if (!visible) {
      setQ(''); setResults([]); setLoading(false); setDegraded(false);
    }
  }, [visible]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q || q.trim().length < 2) {
      setResults([]); setDebouncing(false); setDegraded(false); return;
    }
    setDebouncing(true);
    timer.current = setTimeout(async () => {
      setLoading(true); setDebouncing(false); setDegraded(false);
      try {
        const r = await api.get('/geocode/search', { q: q.trim(), limit: 8 });
        if (r?.degraded === true) {
          setDegraded(true);
          setResults([]);
        } else {
          setResults(r?.results || []);
        }
      } catch {
        // Any network-level failure (timeout, offline, 5xx before the
        // graceful wrapper fires) collapses into the same "unavailable"
        // state so the user sees consistent copy instead of a blank list.
        setDegraded(true);
        setResults([]);
      }
      finally { setLoading(false); }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={styles.head}>
          <Text style={styles.title}>Search a place</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} testID="place-search-close">
            <X size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <Search size={16} color={colors.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Park name, address, landmark…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            testID="place-search-input"
          />
          {(loading || debouncing) && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        {q.trim().length >= 2 && !loading && results.length === 0 && !debouncing && !degraded && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No results found</Text>
            <Text style={styles.emptyBody}>Try a different name or create the location manually.</Text>
            {onManualEntry && (
              <TouchableOpacity style={styles.manualBtn} onPress={() => { onClose(); onManualEntry(); }} testID="place-search-manual">
                <Plus size={14} color={colors.textInverse} />
                <Text style={styles.manualBtnTxt}>Create custom location manually</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Batch #7 — degraded-geocoder banner. Takes priority over the
            empty-state UI so the user sees "this is us, not your query"
            copy and still has a clean path to drop a pin manually. */}
        {degraded && !loading && !debouncing && (
          <View style={styles.emptyWrap} testID="place-search-degraded">
            <Text style={styles.emptyTitle}>Location search is temporarily unavailable</Text>
            <Text style={styles.emptyBody}>
              You can still drop a pin manually — everything else about your spot
              will save normally.
            </Text>
            {onManualEntry && (
              <TouchableOpacity
                style={styles.manualBtn}
                onPress={() => { onClose(); onManualEntry(); }}
                testID="place-search-manual-degraded"
              >
                <Plus size={14} color={colors.textInverse} />
                <Text style={styles.manualBtnTxt}>Drop a pin manually</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {q.trim().length < 2 && (
          <View style={styles.hintWrap}>
            <Text style={styles.hint}>Start typing a park, landmark, business, or address.</Text>
            <Text style={styles.hintExamples}>McAllister Park  ·  Pearl District  ·  Muleshoe Bend  ·  123 Main St</Text>
          </View>
        )}

        <FlatList
          data={results}
          keyExtractor={(r) => r.place_id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const ftype = (item.type || '').toLowerCase();
            const badgeLabel =
              ftype === 'poi' ? 'Landmark' :
              ftype === 'address' ? 'Address' :
              ftype === 'neighborhood' ? 'Area' :
              ftype === 'locality' || ftype === 'place' ? 'Place' :
              ftype === 'street' ? 'Street' : null;
            const zipStateLine = [
              item.city,
              item.state,
              item.postcode,
            ].filter(Boolean).join(', ');
            return (
              <Pressable
                onPress={() => { onPick(item); onClose(); }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
                testID={`place-result-${item.place_id}`}
              >
                <View style={styles.pinWrap}><MapPin size={16} color={colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.name || item.display_name.split(',')[0]}
                    </Text>
                    {badgeLabel && (
                      <View style={styles.typeBadge}>
                        <Text style={styles.typeBadgeTxt}>{badgeLabel}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {zipStateLine || item.display_name}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'ios' ? 8 : space.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingVertical: space.md },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    marginHorizontal: space.xl, paddingHorizontal: space.md, paddingVertical: 12,
    borderRadius: radii.md, marginBottom: space.md },
  input: { flex: 1, color: colors.text, fontFamily: font.body, fontSize: 16 },
  hintWrap: { paddingHorizontal: space.xl, gap: 4, marginTop: 20 },
  hint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  hintExamples: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  emptyWrap: { paddingHorizontal: space.xl, alignItems: 'flex-start', gap: 8, marginTop: 20 },
  emptyTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 },
  emptyBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  manualBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radii.md, marginTop: 10 },
  manualBtnTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  pinWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.12)', alignItems: 'center', justifyContent: 'center' },
  rowName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  rowMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radii.pill, backgroundColor: 'rgba(245,166,35,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,166,35,0.4)' },
  typeBadgeTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 9 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border } });
