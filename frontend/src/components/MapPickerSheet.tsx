import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator, Alert } from 'react-native';
import { X, Check, MapPin, Crosshair } from 'lucide-react-native';
import * as Location from 'expo-location';
import { api } from '../api';
import { colors, font, space, radii } from '../theme';

/**
 * Drop-pin-on-map sheet. Shows a draggable marker, performs reverse geocode
 * on drag-end to label the pin with the nearest city/state.
 * NOTE: react-native-maps is loaded LAZILY on first open (not at module import
 * time) so an absent native binary — e.g. Expo Go without a dev client — does
 * not crash the whole Add Spot screen; users just get a graceful fallback.
 */
export default function MapPickerSheet({
  visible,
  onClose,
  onConfirm,
  initial,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (pin: { latitude: number; longitude: number; label: string; city: string; state: string; country: string }) => void;
  initial?: { latitude: number; longitude: number } | null;
}) {
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(initial || null);
  const [labelInfo, setLabelInfo] = useState<{ label: string; city: string; state: string; country: string } | null>(null);
  const [reversing, setReversing] = useState(false);
  const [mapsMod, setMapsMod] = useState<{ MapView: any; Marker: any } | null>(null);
  const [mapsFailed, setMapsFailed] = useState(false);
  const mapRef = useRef<any>(null);

  // Lazy-load maps the first time the sheet becomes visible.
  useEffect(() => {
    if (!visible || mapsMod || mapsFailed || Platform.OS === 'web') return;
    try {
      const mod = require('react-native-maps');
      setMapsMod({ MapView: mod.default, Marker: mod.Marker });
    } catch {
      setMapsFailed(true);
    }
  }, [visible, mapsMod, mapsFailed]);

  // Default center when no pin yet — Austin, TX
  const defaultRegion = useMemo(() => ({
    latitude: initial?.latitude ?? 30.2672,
    longitude: initial?.longitude ?? -97.7431,
    latitudeDelta: 0.25,
    longitudeDelta: 0.25,
  }), [initial?.latitude, initial?.longitude]);

  useEffect(() => {
    if (!visible) {
      setPin(initial || null);
      setLabelInfo(null);
    }
  }, [visible, initial]);

  const reverse = async (latitude: number, longitude: number) => {
    setReversing(true);
    try {
      const r = await api.get('/geocode/reverse', { lat: latitude, lng: longitude });
      setLabelInfo({
        label: r?.name || r?.display_name || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        city: r?.city || '',
        state: r?.state || '',
        country: r?.country || 'USA',
      });
    } catch {
      setLabelInfo({ label: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, city: '', state: '', country: 'USA' });
    } finally { setReversing(false); }
  };

  const centerOnMe = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission denied', 'Drop a pin by tapping the map instead.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setPin(p);
      reverse(p.latitude, p.longitude);
      mapRef.current?.animateToRegion({ ...p, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
    } catch (e) {
      Alert.alert('Could not read location', String(e));
    }
  };

  const handleMapPress = (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPin({ latitude, longitude });
    reverse(latitude, longitude);
  };

  const handleDragEnd = (e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPin({ latitude, longitude });
    reverse(latitude, longitude);
  };

  const confirm = () => {
    if (!pin) {
      Alert.alert('Drop a pin first', 'Tap the map to place a pin, then Confirm.');
      return;
    }
    const info = labelInfo || { label: `${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)}`, city: '', state: '', country: 'USA' };
    onConfirm({ ...pin, ...info });
    onClose();
  };

  if (!mapsMod) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
        <View style={styles.webFallback}>
          <MapPin size={28} color={colors.primary} />
          <Text style={styles.webFallbackTitle}>
            {Platform.OS === 'web' ? 'Map picker unavailable on web' : mapsFailed ? 'Map not available in this build' : 'Loading map…'}
          </Text>
          <Text style={styles.webFallbackBody}>Use the mobile app with a dev client to drop a pin, or try "Search a place" / "Enter manually".</Text>
          <TouchableOpacity style={styles.webBackBtn} onPress={onClose}>
            <Text style={styles.webBackTxt}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  const { MapView, Marker } = mapsMod;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.head}>
          <Text style={styles.title}>Drop a pin</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} testID="map-picker-close">
            <X size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={defaultRegion}
            onPress={handleMapPress}
            showsUserLocation
          >
            {pin && (
              <Marker
                coordinate={pin}
                draggable
                onDragEnd={handleDragEnd}
                pinColor={colors.primary}
              />
            )}
          </MapView>
          <TouchableOpacity style={styles.myLoc} onPress={centerOnMe} testID="map-picker-mylocation">
            <Crosshair size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          {pin ? (
            <>
              <View style={{ flex: 1 }}>
                {reversing && <ActivityIndicator size="small" color={colors.primary} />}
                <Text style={styles.coord}>{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</Text>
                {labelInfo && (
                  <Text style={styles.label} numberOfLines={1}>
                    {labelInfo.label}{labelInfo.city ? ` · ${labelInfo.city}, ${labelInfo.state}` : ''}
                  </Text>
                )}
              </View>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirm} testID="map-picker-confirm">
                <Check size={16} color={colors.textInverse} />
                <Text style={styles.confirmTxt}>Use this pin</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.hint}>Tap the map to drop a pin, then Confirm.</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: Platform.OS === 'ios' ? 14 : space.xl, paddingBottom: space.md },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: space.xl, backgroundColor: colors.surface1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  coord: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  label: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  hint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 13 },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.md },
  confirmTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
  myLoc: {
    position: 'absolute', right: space.xl, bottom: space.xl,
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  webFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: 10, backgroundColor: colors.bg },
  webFallbackTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, textAlign: 'center' },
  webFallbackBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center' },
  webBackBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.primary },
  webBackTxt: { color: colors.textInverse, fontFamily: font.bodySemibold, fontSize: 14 },
});
