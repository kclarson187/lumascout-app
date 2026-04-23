/**
 * AdminSpotMenu — bottom-sheet of moderation actions for a spot.
 * Visible only to admin / super_admin. Accessible via kebab (⋮) or long-press.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import {
  X, Crop, ImagePlus, Layers, Star, Eye, EyeOff,
  CheckCircle2, XCircle, Edit3, Trash2, ChevronRight,
} from 'lucide-react-native';
import { api } from '../api';
import { colors, font, space, radii } from '../theme';

export type AdminSpotMenuProps = {
  visible: boolean;
  spot: any;
  role: 'admin' | 'super_admin' | string;
  onClose: () => void;
  onAfterChange?: () => void;
};

type ActionRow = {
  key: string;
  label: string;
  hint?: string;
  icon: any;
  color?: string;
  destructive?: boolean;
  run: () => Promise<void> | void;
};

export default function AdminSpotMenu({ visible, spot, role, onClose, onAfterChange }: AdminSpotMenuProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const isSuperAdmin = role === 'super_admin';
  if (!spot) return null;

  const doAction = async (key: string, action: string, confirmLabel?: string, destructive?: boolean) => {
    const run = async () => {
      setBusyKey(key);
      try {
        await api.post(`/admin/spots/${spot.spot_id}/action`, { action });
        onAfterChange?.();
        onClose();
      } catch (e: any) {
        Alert.alert('Error', e?.response?.data?.detail || 'Action failed.');
      } finally { setBusyKey(null); }
    };
    if (confirmLabel) {
      Alert.alert(confirmLabel, `Apply "${confirmLabel}" to "${spot.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: run },
      ]);
    } else {
      run();
    }
  };

  const goCoverEditor = () => {
    onClose();
    // Small delay so modal animation doesn't fight router push
    setTimeout(() => router.push(`/admin/spots/${spot.spot_id}/cover` as any), 120);
  };

  const goEditInfo = () => {
    onClose();
    setTimeout(() => router.push(`/spot/${spot.spot_id}/edit` as any), 120);
  };

  // Build action rows in priority order
  const rows: ActionRow[] = [
    { key: 'cover', label: 'Change cover photo', hint: 'Pick from gallery or UGC', icon: ImagePlus, run: goCoverEditor },
    { key: 'reposition', label: 'Reposition / zoom', hint: 'Drag focal point · pinch to zoom', icon: Crop, run: goCoverEditor },
    {
      key: spot.featured ? 'unfeature' : 'feature',
      label: spot.featured ? 'Unfeature spot' : 'Feature spot',
      hint: spot.featured ? 'Remove from featured rails' : 'Add to featured rails',
      icon: Star,
      color: colors.primary,
      run: () => doAction(spot.featured ? 'unfeature' : 'feature', spot.featured ? 'unfeature' : 'feature'),
    },
    {
      key: spot.hidden_from_explore ? 'unhide' : 'hide',
      label: spot.hidden_from_explore ? 'Unhide from Explore' : 'Hide from Explore',
      hint: spot.hidden_from_explore ? 'Return to public feeds' : 'Keep page alive but remove from discovery',
      icon: spot.hidden_from_explore ? Eye : EyeOff,
      run: () => doAction(spot.hidden_from_explore ? 'unhide' : 'hide', spot.hidden_from_explore ? 'unhide' : 'hide',
                          spot.hidden_from_explore ? undefined : 'Hide spot'),
    },
  ];
  if (spot.visibility_status !== 'approved') {
    rows.push({
      key: 'approve', label: 'Approve spot', hint: 'Publish to Explore',
      icon: CheckCircle2, color: colors.success,
      run: () => doAction('approve', 'approve'),
    });
  }
  if (spot.visibility_status !== 'rejected') {
    rows.push({
      key: 'reject', label: 'Deny spot', hint: 'Mark as rejected',
      icon: XCircle, color: colors.secondary, destructive: true,
      run: () => doAction('reject', 'reject', 'Deny', true),
    });
  }
  rows.push({
    key: 'edit', label: 'Edit spot info', hint: 'Title · description · category', icon: Edit3,
    run: goEditInfo,
  });
  if (isSuperAdmin) {
    rows.push({
      key: 'delete', label: 'Delete spot', hint: 'Permanently remove · cannot be undone',
      icon: Trash2, color: colors.secondary, destructive: true,
      run: () => doAction('delete', 'delete', 'Delete spot', true),
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <View style={styles.adminChip}>
                <Text style={styles.adminChipTxt}>🛠 ADMIN</Text>
              </View>
              <Text style={styles.title} numberOfLines={1}>{spot.title}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {spot.city || ''}{spot.state ? ` · ${spot.state}` : ''}
                {spot.quality_score != null ? `  ·  Q${spot.quality_score}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.rows}>
            {rows.map((r) => {
              const Icon = r.icon;
              const active = busyKey === r.key;
              return (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.row, r.destructive && { borderColor: 'rgba(208,72,72,0.25)' }]}
                  onPress={r.run}
                  activeOpacity={0.75}
                  disabled={busyKey !== null}
                  testID={`admin-menu-${r.key}`}
                >
                  <View style={[styles.rowIcon, r.color && { backgroundColor: colorWithAlpha(r.color, 0.15), borderColor: r.color }]}>
                    {active ? <ActivityIndicator size="small" color={r.color || colors.primary} /> : (
                      <Icon size={16} color={r.color || colors.text} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, r.destructive && { color: colors.secondary }]}>{r.label}</Text>
                    {r.hint ? <Text style={styles.rowHint}>{r.hint}</Text> : null}
                  </View>
                  <ChevronRight size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function colorWithAlpha(hex: string, alpha: number) {
  // Accept colors like '#ff0000' OR theme token (fallback to string)
  if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) return `rgba(245,166,35,${alpha})`;
  const h = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border,
    paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 28,
    gap: 4,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingBottom: 8 },
  adminChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: colors.primary,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4,
    marginBottom: 4,
  },
  adminChipTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 1 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 18 },
  sub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface1, alignItems: 'center', justifyContent: 'center' },

  rows: { gap: 6, paddingTop: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  rowHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
});
