/**
 * Admin Explore Cover Photo Editor.
 * Path: /admin/spots/[id]/cover
 *
 * Tools:
 *   - Pan the image inside a 16:9 frame to reposition focal point
 *   - Pinch-to-zoom (1.0 – 3.0x)
 *   - Reset crop
 *   - Rotate in 90° increments
 *   - Pick alternative cover from spot images + community uploads
 *   - Reorder gallery (tap to promote to index 0)
 *   - Live preview cards: Explore feed (16:9), hero (4:3), map thumbnail (1:1)
 *   - Admin quick actions: Approve / Reject / Feature / Hide / Delete
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, runOnJS,
} from 'react-native-reanimated';
import {
  ArrowLeft, Check, X, RotateCcw, RotateCw, Eye, EyeOff,
  Star, Trash2, Crosshair, Save, ImagePlus, ChevronUp, Users, ShieldCheck,
} from 'lucide-react-native';
import { api } from '../../../../src/api';
import { useAuth } from '../../../../src/auth';
import { colors, font, space, radii } from '../../../../src/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const CANVAS_W = Math.min(SCREEN_W - 32, 360);
const CANVAS_H = Math.round(CANVAS_W * 9 / 16);   // 16:9 preview frame
// Location Detail Page hero = square 1:1 (see app/spot/[id].tsx heroImg).
// Kept as a named constant so the preview tile stays accurate even if
// the detail hero aspect is retuned later.
const W_DETAIL_HERO_ASPECT = 1;

type CoverImage = {
  image_url: string;
  caption?: string | null;
  is_cover?: boolean;
  source: 'spot' | 'community';
  featured?: boolean;
  like_count?: number;
  upload_id?: string;
  contributor?: { name?: string; avatar_url?: string | null } | null;
};

type Payload = {
  spot: any;
  images: CoverImage[];
  admin_cover_override?: any;
};

const MIN_SCALE = 1.0;
const MAX_SCALE = 3.0;

export default function CoverEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  // Animated transform state (shared values)
  const focalX = useSharedValue(0.5);
  const focalY = useSharedValue(0.5);
  const scale = useSharedValue(1.0);
  const rotation = useSharedValue(0);
  // Pan state during gesture
  const panStartX = useSharedValue(0.5);
  const panStartY = useSharedValue(0.5);
  const pinchStart = useSharedValue(1.0);

  // Apr 2026 — owners can edit their own cover too. We rely on the
  // backend to enforce role/ownership and return 403 if not allowed.
  // Old hard client-gate removed; backend errors surface via Alert.
  const isAdmin = !!user && ['admin', 'super_admin'].includes(user.role);
  const isSuperAdmin = !!user && user.role === 'super_admin';
  const isOwner = !!user && !!data && (data as any).created_by === user.user_id;
  const canEdit = isAdmin || isOwner;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r: Payload = await api.get(`/admin/spots/${id}/cover-editor`);
      setData(r);
      const ov = r.admin_cover_override;
      const initial = ov?.image_url || r.images.find((i) => i.is_cover)?.image_url || r.images[0]?.image_url || null;
      setSelectedUrl(initial);
      focalX.value = ov?.focal_x ?? 0.5;
      focalY.value = ov?.focal_y ?? 0.5;
      scale.value = ov?.scale ?? 1.0;
      rotation.value = ov?.rotation ?? 0;
    } catch (e: any) {
      Alert.alert('Could not load', e?.response?.data?.detail || e?.message || 'Please try again.');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const resetCrop = () => {
    focalX.value = withSpring(0.5, { damping: 20 });
    focalY.value = withSpring(0.5, { damping: 20 });
    scale.value = withSpring(1.0, { damping: 20 });
    rotation.value = 0;
  };

  const rotate = (dir: 1 | -1) => {
    const next = (rotation.value + dir * 90 + 360) % 360;
    rotation.value = next;
  };

  // Small helper — invalidate every cache that holds a rendered cover
  // for this spot so the admin's override (or reset) propagates instantly
  // across Explore list, Map markers, Saved, Groups, and the detail
  // page without the user needing to pull-to-refresh.
  const invalidateSpotCaches = async () => {
    try {
      const { invalidateCachePrefix } = await import('../../../../src/utils/swrCache');
      await Promise.all([
        invalidateCachePrefix('explore.list:v1'),
        invalidateCachePrefix('saved:v1'),
        invalidateCachePrefix('groups:v1'),
        invalidateCachePrefix(`spot:${id}`),
      ]);
    } catch {}
  };

  const saveOverride = async () => {
    if (!selectedUrl || !id) return;
    setSaving(true);
    try {
      await api.patch(`/admin/spots/${id}/cover`, {
        image_url: selectedUrl,
        focal_x: Number(focalX.value.toFixed(3)),
        focal_y: Number(focalY.value.toFixed(3)),
        scale: Number(scale.value.toFixed(2)),
        rotation: Math.round(rotation.value) % 360,
      });
      await invalidateSpotCaches();
      Alert.alert('Saved', 'Cover updated across Explore, detail pages, and map thumbnails.');
      load();
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.detail || 'Please try again.');
    } finally { setSaving(false); }
  };

  const clearOverride = async () => {
    if (!id) return;
    Alert.alert('Clear override?', 'Cover will revert to the auto-rotation stack (admin featured → recent → seasonal → original).', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        try {
          await api.delete(`/admin/spots/${id}/cover`);
          await invalidateSpotCaches();
          load();
        } catch (e: any) {
          Alert.alert('Error', e?.response?.data?.detail || 'Failed.');
        }
      } },
    ]);
  };

  const promoteToCover = async (url: string) => {
    if (!data || !id) return;
    // Tap on a spot image → reorder so it becomes images[0] (fallback cover)
    const urls = [url, ...data.images.filter((i) => i.source === 'spot' && i.image_url !== url).map((i) => i.image_url)];
    try {
      await api.patch(`/admin/spots/${id}/gallery`, { image_urls: urls });
      await invalidateSpotCaches();
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed.');
    }
  };

  const doAction = async (action: string) => {
    if (!id) return;
    try {
      await api.post(`/admin/spots/${id}/action`, { action });
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail || 'Failed.');
    }
  };

  const confirmAction = (action: string, label: string, destructive = false) => {
    Alert.alert(label, `Apply "${label}" to this spot?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, style: destructive ? 'destructive' : 'default', onPress: () => doAction(action) },
    ]);
  };

  // --- Gestures ---
  const panGesture = Gesture.Pan()
    .onStart(() => {
      panStartX.value = focalX.value;
      panStartY.value = focalY.value;
    })
    .onUpdate((e) => {
      // Convert pan delta into focal-point delta (inverse so moving right shows left)
      const s = scale.value;
      const dx = -e.translationX / (CANVAS_W * s);
      const dy = -e.translationY / (CANVAS_H * s);
      let nx = panStartX.value + dx;
      let ny = panStartY.value + dy;
      // Clamp inside [0,1]
      if (nx < 0) nx = 0; if (nx > 1) nx = 1;
      if (ny < 0) ny = 0; if (ny > 1) ny = 1;
      focalX.value = nx;
      focalY.value = ny;
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => { pinchStart.value = scale.value; })
    .onUpdate((e) => {
      const next = pinchStart.value * e.scale;
      if (next < MIN_SCALE) scale.value = MIN_SCALE;
      else if (next > MAX_SCALE) scale.value = MAX_SCALE;
      else scale.value = next;
    });

  const combined = Gesture.Simultaneous(panGesture, pinchGesture);

  // Image animated style — translates based on focal offset × scale.
  const imgStyle = useAnimatedStyle(() => {
    // When scale > 1, the image is bigger than the frame. We want the focal
    // point to sit at the center. So translateX = (0.5 - focalX) * (scaledW - frameW)
    const s = scale.value;
    const scaledW = CANVAS_W * s;
    const scaledH = CANVAS_H * s;
    const tx = (0.5 - focalX.value) * (scaledW - CANVAS_W);
    const ty = (0.5 - focalY.value) * (scaledH - CANVAS_H);
    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { scale: s },
        { rotate: `${rotation.value}deg` },
      ],
    };
  });

  // Crosshair overlay position in pixels inside the frame
  const crosshairStyle = useAnimatedStyle(() => ({
    left: focalX.value * CANVAS_W - 14,
    top:  focalY.value * CANVAS_H - 14,
  }));

  if (!canEdit && !loading) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <ShieldCheck size={30} color={colors.textTertiary} />
          <Text style={styles.emptyTxt}>You can only edit covers on your own spots, or as an admin.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const hasOverride = !!data.admin_cover_override;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />

        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.hBtn} hitSlop={10}>
            <ArrowLeft size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>Cover Editor</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {data.spot.title} {data.spot.city ? `· ${data.spot.city}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={saveOverride} disabled={saving || !selectedUrl} style={[styles.saveBtn, (!selectedUrl || saving) && { opacity: 0.5 }]}>
            {saving ? <ActivityIndicator color={colors.textInverse} /> : (
              <><Save size={14} color={colors.textInverse} /><Text style={styles.saveTxt}>Save</Text></>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Editor canvas */}
          <View style={styles.canvasWrap}>
            <GestureDetector gesture={combined}>
              <View style={styles.canvas}>
                {selectedUrl ? (
                  <Animated.Image
                    source={{ uri: selectedUrl }}
                    style={[styles.canvasImg, imgStyle]}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.canvasImg, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: colors.textTertiary }}>Select an image below</Text>
                  </View>
                )}
                {/* Rule-of-thirds overlay */}
                <View style={styles.grid} pointerEvents="none">
                  <View style={[styles.gridLineH, { top: CANVAS_H / 3 }]} />
                  <View style={[styles.gridLineH, { top: 2 * CANVAS_H / 3 }]} />
                  <View style={[styles.gridLineV, { left: CANVAS_W / 3 }]} />
                  <View style={[styles.gridLineV, { left: 2 * CANVAS_W / 3 }]} />
                </View>
                {/* Focal crosshair */}
                <Animated.View style={[styles.crosshair, crosshairStyle]} pointerEvents="none">
                  <Crosshair size={28} color={colors.primary} strokeWidth={2.5} />
                </Animated.View>
              </View>
            </GestureDetector>
            <Text style={styles.canvasHint}>
              Drag to reposition · pinch to zoom · 16:9 preview frame
            </Text>

            {/* Scale slider (tap-steps) */}
            <ZoomRail scale={scale} />

            {/* Crop toolbar */}
            <View style={styles.cropToolbar}>
              <CropBtn icon={<RotateCcw size={16} color={colors.text} />} label="Reset" onPress={resetCrop} />
              <CropBtn icon={<RotateCw size={16} color={colors.text} />} label="Rotate" onPress={() => rotate(1)} />
              {hasOverride && (
                <CropBtn icon={<X size={16} color={colors.secondary} />} label="Clear override" onPress={clearOverride} danger />
              )}
            </View>
          </View>

          {/* Live preview cards — how the selected image will appear
              in each placement. The fourth tile "Location Detail"
              mirrors the exact aspect the hero carousel on the spot
              detail page uses, so admins can frame confidently before
              saving. All four update live as you pan / pinch / rotate
              the editor canvas — no save required to preview. */}
          <Text style={styles.sectionLabel}>Live preview</Text>
          <View style={styles.previewRow}>
            <PreviewCard label="Feed (16:9)" aspect={16 / 9} url={selectedUrl} focalX={focalX} focalY={focalY} scale={scale} rotation={rotation} />
            <PreviewCard label="Hero (4:3)" aspect={4 / 3} url={selectedUrl} focalX={focalX} focalY={focalY} scale={scale} rotation={rotation} />
            <PreviewCard label="Map (1:1)" aspect={1} url={selectedUrl} focalX={focalX} focalY={focalY} scale={scale} rotation={rotation} />
            <PreviewCard label="Location Detail" aspect={W_DETAIL_HERO_ASPECT} url={selectedUrl} focalX={focalX} focalY={focalY} scale={scale} rotation={rotation} />
          </View>

          {/* Quick admin actions */}
          <Text style={styles.sectionLabel}>Quick actions</Text>
          <View style={styles.actionsRow}>
            {data.spot.visibility_status !== 'approved' && (
              <QuickAction icon={<Check size={14} color={colors.textInverse} />} label="Approve" bg={colors.success} onPress={() => doAction('approve')} />
            )}
            {data.spot.visibility_status !== 'rejected' && (
              <QuickAction icon={<X size={14} color={colors.secondary} />} label="Reject" bg="transparent" border={colors.secondary} color={colors.secondary} onPress={() => confirmAction('reject', 'Reject', true)} />
            )}
            {data.spot.featured ? (
              <QuickAction icon={<Star size={14} color={colors.primary} fill={colors.primary} />} label="Unfeature" bg="rgba(245,166,35,0.15)" border={colors.primary} color={colors.primary} onPress={() => doAction('unfeature')} />
            ) : (
              <QuickAction icon={<Star size={14} color={colors.textInverse} />} label="Feature" bg={colors.primary} onPress={() => doAction('feature')} />
            )}
            {data.spot.hidden_from_explore ? (
              <QuickAction icon={<Eye size={14} color={colors.textInverse} />} label="Unhide" bg={colors.surface2} color={colors.text} onPress={() => doAction('unhide')} />
            ) : (
              <QuickAction icon={<EyeOff size={14} color={colors.text} />} label="Hide" bg={colors.surface2} color={colors.text} onPress={() => confirmAction('hide', 'Hide')} />
            )}
            {isSuperAdmin && (
              <QuickAction icon={<Trash2 size={14} color={colors.secondary} />} label="Delete" bg="transparent" border={colors.secondary} color={colors.secondary} onPress={() => confirmAction('delete', 'Delete spot', true)} />
            )}
          </View>

          {/* Gallery selector */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>All photos ({data.images.length})</Text>
            <Text style={styles.sectionHint}>Tap to use · hold to promote to cover</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
            {data.images.map((img) => {
              const active = img.image_url === selectedUrl;
              const isCurrentCover = !!data.admin_cover_override?.image_url
                ? img.image_url === data.admin_cover_override.image_url
                : img.is_cover;
              return (
                <TouchableOpacity
                  key={img.upload_id || img.image_url}
                  onPress={() => {
                    setSelectedUrl(img.image_url);
                    // If the tapped image matches the saved override, restore its crop
                    const ov = data.admin_cover_override;
                    if (ov && ov.image_url === img.image_url) {
                      focalX.value = ov.focal_x ?? 0.5;
                      focalY.value = ov.focal_y ?? 0.5;
                      scale.value = ov.scale ?? 1.0;
                      rotation.value = ov.rotation ?? 0;
                    } else {
                      focalX.value = withSpring(0.5); focalY.value = withSpring(0.5);
                      scale.value = withSpring(1.0); rotation.value = 0;
                    }
                  }}
                  onLongPress={() => {
                    if (img.source === 'spot') promoteToCover(img.image_url);
                  }}
                  style={[styles.galleryCell, active && styles.galleryCellActive]}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri: img.image_url }} style={styles.galleryImg} />
                  {img.source === 'community' && (
                    <View style={styles.sourceChip}>
                      <Users size={8} color={colors.textInverse} />
                      <Text style={styles.sourceChipTxt}>UGC</Text>
                    </View>
                  )}
                  {isCurrentCover && (
                    <View style={[styles.sourceChip, { backgroundColor: colors.primary, left: 4, right: undefined, top: 4 }]}>
                      <Text style={[styles.sourceChipTxt, { color: colors.textInverse }]}>COVER</Text>
                    </View>
                  )}
                  {img.featured && !isCurrentCover && (
                    <View style={[styles.sourceChip, { backgroundColor: colors.success, left: 4, right: undefined, top: 4 }]}>
                      <Text style={[styles.sourceChipTxt, { color: colors.textInverse }]}>FEATURED</Text>
                    </View>
                  )}
                  {active && (
                    <View style={styles.activeIndicator}>
                      <Check size={14} color={colors.textInverse} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={{ paddingHorizontal: space.lg, paddingTop: 10 }}>
            <Text style={styles.tipTxt}>
              💡 Tip: tap any photo above to preview it as cover. Drag / pinch to reposition.
              Hit <Text style={{ color: colors.primary, fontFamily: font.bodyBold }}>Save</Text> to publish the new cover across Explore, Spot detail, and map thumbnails.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ------------------- Preview card (small) -------------------
function PreviewCard({
  label, aspect, url, focalX, focalY, scale, rotation,
}: {
  label: string; aspect: number; url: string | null;
  focalX: any; focalY: any; scale: any; rotation: any;
}) {
  const W = 105;
  const H = Math.round(W / aspect);
  const imgStyle = useAnimatedStyle(() => {
    const s = scale.value;
    const scaledW = W * s;
    const scaledH = H * s;
    const tx = (0.5 - focalX.value) * (scaledW - W);
    const ty = (0.5 - focalY.value) * (scaledH - H);
    return {
      transform: [{ translateX: tx }, { translateY: ty }, { scale: s }, { rotate: `${rotation.value}deg` }],
    };
  });
  return (
    <View style={styles.previewCard}>
      <View style={{ width: W, height: H, overflow: 'hidden', borderRadius: radii.sm, backgroundColor: colors.surface2 }}>
        {url ? (
          <Animated.Image source={{ uri: url }} style={[{ width: W, height: H }, imgStyle]} resizeMode="cover" />
        ) : null}
      </View>
      <Text style={styles.previewLabel}>{label}</Text>
    </View>
  );
}

// ------------------- Zoom rail -------------------
function ZoomRail({ scale }: { scale: any }) {
  const [value, setValue] = useState(1.0);
  // Poll shared value periodically to reflect
  useEffect(() => {
    const t = setInterval(() => setValue(Number(scale.value.toFixed(2))), 120);
    return () => clearInterval(t);
  }, []);
  const stepTo = (v: number) => {
    scale.value = withSpring(v, { damping: 18 });
  };
  const filled = (value - MIN_SCALE) / (MAX_SCALE - MIN_SCALE);
  return (
    <View style={styles.zoomRow}>
      <Text style={styles.zoomLabel}>Zoom</Text>
      <View style={styles.zoomBar}>
        <View style={[styles.zoomFill, { width: `${Math.max(0, Math.min(1, filled)) * 100}%` }]} />
      </View>
      <Text style={styles.zoomVal}>{value.toFixed(1)}×</Text>
      <TouchableOpacity onPress={() => stepTo(Math.max(MIN_SCALE, value - 0.2))} style={styles.zoomStep}><Text style={styles.zoomStepTxt}>–</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => stepTo(Math.min(MAX_SCALE, value + 0.2))} style={styles.zoomStep}><Text style={styles.zoomStepTxt}>+</Text></TouchableOpacity>
    </View>
  );
}

// ------------------- Small building blocks -------------------
function CropBtn({ icon, label, onPress, danger }: { icon: any; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity style={[styles.cropBtn, danger && { borderColor: colors.secondary }]} onPress={onPress} activeOpacity={0.75}>
      {icon}
      <Text style={[styles.cropBtnTxt, danger && { color: colors.secondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function QuickAction({ icon, label, bg, border, color, onPress }: {
  icon: any; label: string; bg: string; border?: string; color?: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.quickBtn, { backgroundColor: bg, borderColor: border || bg }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {icon}
      <Text style={[styles.quickBtnTxt, { color: color || colors.textInverse }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.sm, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  headerSub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 9, paddingHorizontal: 14,
    backgroundColor: colors.primary, borderRadius: radii.md,
    marginRight: 8,
  },
  saveTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },

  canvasWrap: { alignItems: 'center', paddingTop: space.md, paddingHorizontal: space.md, gap: 10 },
  canvas: {
    width: CANVAS_W, height: CANVAS_H,
    borderRadius: radii.md, overflow: 'hidden',
    backgroundColor: '#0a0a0a',
    borderWidth: 1, borderColor: colors.border,
  },
  canvasImg: { position: 'absolute', width: CANVAS_W, height: CANVAS_H },
  canvasHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  grid: { position: 'absolute', top: 0, left: 0, width: CANVAS_W, height: CANVAS_H },
  gridLineH: { position: 'absolute', left: 0, width: CANVAS_W, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  gridLineV: { position: 'absolute', top: 0, height: CANVAS_H, width: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  crosshair: { position: 'absolute', width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: CANVAS_W, marginTop: 6 },
  zoomLabel: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, width: 38 },
  zoomBar: { flex: 1, height: 4, backgroundColor: colors.surface2, borderRadius: 2, overflow: 'hidden' },
  zoomFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  zoomVal: { color: colors.text, fontFamily: font.bodyBold, fontSize: 11, width: 34, textAlign: 'right' },
  zoomStep: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  zoomStepTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 16, lineHeight: 16, includeFontPadding: false },

  cropToolbar: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  cropBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  cropBtnTxt: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 12 },

  sectionLabel: {
    color: colors.text, fontFamily: font.bodyBold, fontSize: 13,
    paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: 8,
    letterSpacing: 0.3,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: 8 },
  sectionHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  previewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',              // 4 tiles now — wrap to 2x2 on small screens
    gap: 10,
    paddingHorizontal: space.md,
  },
  previewCard: {
    alignItems: 'center',
    gap: 6,
    width: '47%',                  // 2 per row with a small gap
  },
  previewLabel: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, letterSpacing: 0.3 },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: space.md },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.pill, borderWidth: 1,
  },
  quickBtnTxt: { fontFamily: font.bodyBold, fontSize: 12 },

  galleryRow: { paddingHorizontal: space.md, gap: 8 },
  galleryCell: {
    width: 92, height: 92, borderRadius: radii.md, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
    position: 'relative',
    backgroundColor: colors.surface2,
  },
  galleryCellActive: { borderColor: colors.primary },
  galleryImg: { width: '100%', height: '100%' },
  sourceChip: {
    position: 'absolute', top: 4, right: 4,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3,
  },
  sourceChipTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 8, letterSpacing: 0.5 },
  activeIndicator: {
    position: 'absolute', bottom: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  tipTxt: {
    color: colors.textSecondary, fontFamily: font.body, fontSize: 12,
    lineHeight: 17, marginTop: 4,
  },
});
