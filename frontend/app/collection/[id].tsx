import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Share2, X, MapPin } from 'lucide-react-native';
import { Image } from 'expo-image';
import { api } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import SpotCard from '../../src/components/SpotCard';
import { EmptyState } from '../../src/components/ui';
import ShareWithClientSheet from '../../src/components/ShareWithClientSheet';

/**
 * Collection detail screen.
 *
 * Jun 2025 — added "Share Location" CTA in the header so photographers
 * can mint a white-themed client share page directly from a Collection.
 *
 *   • If the collection has 0 spots, the button is hidden (no usable
 *     payload).
 *   • Exactly 1 spot → tap opens ShareWithClientSheet for that spot.
 *   • Multiple spots → tap opens a lightweight chooser modal listing
 *     each spot's cover + title. Tap a spot → opens the share sheet
 *     for that spot. Keeps backend surface unchanged (no new collection
 *     share endpoint required) — every share is still a single
 *     location, per the white-page redesign brief.
 */
export default function Collection() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [col, setCol] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [shareSpotId, setShareSpotId] = useState<string | null>(null);
  const [shareSpotName, setShareSpotName] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/collections/${id}`);
      setCol(d);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const spots = col?.spots || [];

  const openShare = (spot: any) => {
    setShareSpotId(spot.spot_id);
    setShareSpotName(spot.title);
    setChooserOpen(false);
  };

  const handleShareTap = () => {
    if (spots.length === 1) {
      openShare(spots[0]);
    } else if (spots.length > 1) {
      setChooserOpen(true);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{col?.name || 'Collection'}</Text>
        {spots.length > 0 ? (
          <TouchableOpacity onPress={handleShareTap} style={styles.shareBtn} testID="collection-share-location">
            <Share2 size={14} color={colors.bg} />
            <Text style={styles.shareBtnTxt}>Share Location</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : !col || !spots.length ? (
        <EmptyState title="Empty collection" subtitle="Add spots to this collection from any spot detail." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 100 }}>
          {spots.map((s: any) => <SpotCard key={s.spot_id} spot={s} width={undefined as any} />)}
        </ScrollView>
      )}

      {/* Spot chooser when >1 spot in the collection */}
      <Modal
        visible={chooserOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setChooserOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setChooserOpen(false)}>
          <Pressable style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalKicker}>Share Location</Text>
                <Text style={styles.modalTitle}>Pick a location to share</Text>
              </View>
              <TouchableOpacity onPress={() => setChooserOpen(false)} hitSlop={10} style={styles.modalClose}>
                <X size={18} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 16 }}>
              {spots.map((s: any) => (
                <Pressable
                  key={s.spot_id}
                  onPress={() => openShare(s)}
                  style={styles.chooserRow}
                  testID={`collection-share-pick-${s.spot_id}`}
                >
                  <View style={styles.chooserThumb}>
                    {s.hero_cover_image_url || s.images?.[0]?.image_url ? (
                      <Image
                        source={{ uri: s.hero_cover_image_url || s.images?.[0]?.image_url }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                      />
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chooserTitle} numberOfLines={1}>{s.title}</Text>
                    {(s.city || s.state) ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <MapPin size={11} color={colors.textTertiary} />
                        <Text style={styles.chooserMeta} numberOfLines={1}>
                          {[s.city, s.state].filter(Boolean).join(', ')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Share2 size={16} color={colors.primary} />
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* The white-themed client share is generated by the same
          ShareWithClientSheet used on Spot Detail. Backend mints a
          token + the public page lives at /api/public/location/{token}
          — see routes/spot_shares.py::_render_public_html. */}
      {shareSpotId ? (
        <ShareWithClientSheet
          visible={!!shareSpotId}
          onClose={() => setShareSpotId(null)}
          spotId={shareSpotId}
          spotName={shareSpotName}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    gap: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontFamily: font.display, fontSize: 22 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  shareBtnTxt: { color: colors.bg, fontFamily: font.bodyBold, fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: space.md },
  modalKicker: { color: colors.kicker, fontFamily: font.bodySemibold, fontSize: 10, letterSpacing: 0.4 },
  modalTitle: { color: colors.text, fontFamily: font.display, fontSize: 20, marginTop: 2, letterSpacing: -0.3 },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  chooserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  chooserThumb: {
    width: 52, height: 52, borderRadius: radii.sm,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  chooserTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13.5 },
  chooserMeta: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11.5 },
});
