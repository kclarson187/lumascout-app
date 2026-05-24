/**
 * ParkMapPin — Phase 4 of the Park-Based Multi-Spot Workflow.
 *
 * Visually-distinct map marker for PARENT PARK records. Used at low
 * zoom levels (latitudeDelta > ~0.5) so a single dot represents an
 * entire park instead of cluttering the map with N child-spot pins.
 *
 * Deliberately NOT a clustering visual — this is data-driven (parent
 * park rows from /api/parks/search), not a viewport-level aggregation.
 * Child spots remain individually tappable when the user zooms in.
 *
 * Design: layered orange tile that reads as a "group" without using a
 * count bubble (count bubbles imply clustering, which the app
 * explicitly does not support).
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Layers } from 'lucide-react-native';
import { colors, font, radii } from '../theme';

type Props = {
  childCount?: number;
};

function ParkMapPinInner({ childCount }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.body}>
        <Layers size={14} color={'#fff'} />
        {typeof childCount === 'number' && childCount > 0 && (
          <Text style={styles.count}>{childCount}</Text>
        )}
      </View>
      <View style={styles.point} />
    </View>
  );
}

const ParkMapPin = React.memo(ParkMapPinInner);
export default ParkMapPin;

const styles = StyleSheet.create({
  // Marker container: keep dimensions tight so react-native-maps' native
  // bitmap snapshot has a small consistent size. No shadows (Android
  // bitmap snapshot can clip them, producing dark squares).
  wrap: { alignItems: 'center' },
  body: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill,
    backgroundColor: colors.primary,
    borderWidth: 2, borderColor: '#fff',
  },
  count: {
    color: '#fff', fontFamily: font.bodyBold, fontSize: 11,
    // No textShadow — Android map bitmap snapshot mishandles it.
  },
  point: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: colors.primary,
    marginTop: -1,
  },
});
