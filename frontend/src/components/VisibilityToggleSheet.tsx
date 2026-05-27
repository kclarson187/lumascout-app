/**
 * VisibilityToggleSheet — Feature 4 Scope B.
 *
 * Lets the owner / admin flip a spot between PUBLIC and PRIVATE, with a
 * confirmation step that summarizes the impact on any active share
 * links so the owner can't silently change recipient access without
 * knowing.
 *
 * The "Show exact location" sub-toggle is shown but visually disabled
 * when the spot is currently public (it only applies to private spots
 * since public spots always show exact coords). Switching from public
 * to private surfaces a summary of how many active share links exist —
 * the per-link show_exact_location is NOT changed (that's immutable on
 * the share row), so existing recipients keep whatever they had at
 * mint time. Only NEW links generated after the toggle will pick up
 * the new spot default.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView,
  ActivityIndicator, Pressable } from 'react-native';
import { X, Globe, Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import { api, formatApiError } from '../api';

type Props = {
  visible: boolean;
  onClose: () => void;
  spotId: string;
  spotTitle: string;
  currentPrivacy: 'public' | 'premium' | 'private' | 'followers' | 'invite_only' | string;
  currentDisplayMode: 'exact' | 'approximate' | 'hidden' | string;
  onSaved: (next: { visibility: 'public' | 'private'; show_exact_location: boolean }) => void;
};

export default function VisibilityToggleSheet({
  visible, onClose, spotId, spotTitle,
  currentPrivacy, currentDisplayMode, onSaved }: Props) {
  const initialIsPublic = currentPrivacy === 'public' || currentPrivacy === 'premium';
  const initialShowExact = initialIsPublic || currentDisplayMode === 'exact';

  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [showExact, setShowExact] = useState(initialShowExact);
  const [activeShareCount, setActiveShareCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [premium, setPremium] = useState(currentPrivacy === 'premium');

  useEffect(() => {
    if (!visible) return;
    setIsPublic(initialIsPublic);
    setShowExact(initialShowExact);
    setErr(null);
    setPremium(currentPrivacy === 'premium');
    // Fetch active share count for impact summary
    api.get(`/spots/${spotId}/shares`).then((r) => {
      const active = (r.items || []).filter((l: any) => !l.revoked).length;
      setActiveShareCount(active);
    }).catch(() => setActiveShareCount(0));
  }, [visible, initialIsPublic, initialShowExact, spotId, currentPrivacy]);

  const dirty = isPublic !== initialIsPublic
    || (!isPublic && showExact !== initialShowExact);

  // Impact summary: which existing links / behaviors are affected.
  const impact = useMemo(() => {
    const lines: string[] = [];
    if (isPublic !== initialIsPublic) {
      if (isPublic) {
        lines.push('Spot becomes discoverable in Explore and search.');
      } else {
        lines.push('Spot is removed from Explore and search.');
      }
    }
    if (activeShareCount && activeShareCount > 0) {
      lines.push(
        `Existing share links keep their original visibility setting (locked at mint time). Affects ${activeShareCount} active link${activeShareCount === 1 ? '' : 's'}.`
      );
      lines.push('Only NEW share links you mint after this change will use the new default.');
    }
    if (!isPublic && initialIsPublic) {
      lines.push(`Default for new links: "${showExact ? 'exact' : 'approximate'} location".`);
    }
    return lines;
  }, [isPublic, initialIsPublic, showExact, activeShareCount]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.patch(`/spots/${spotId}/visibility`, {
        visibility: isPublic ? 'public' : 'private',
        show_exact_location: isPublic ? true : showExact });
      onSaved({
        visibility: r.visibility,
        show_exact_location: r.show_exact_location });
      onClose();
    } catch (e: any) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Visibility</Text>
              <Text style={styles.sub} numberOfLines={1}>{spotTitle}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: space.xxxl }}>
            {premium ? (
              <View style={styles.warnBox}>
                <AlertTriangle size={16} color={colors.warning} />
                <Text style={styles.warnText}>
                  This is a Premium (sellable) spot. To change visibility,
                  use the marketplace listing controls instead.
                </Text>
              </View>
            ) : null}

            {err ? (
              <View style={styles.errBox}><Text style={styles.errText}>{err}</Text></View>
            ) : null}

            {/* Public / Private radio */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Who can find this spot</Text>
              <Pressable
                style={[styles.optionRow, isPublic && styles.optionRowOn]}
                onPress={() => !premium && setIsPublic(true)}
                disabled={premium}
                testID="visibility-public"
              >
                <Globe size={18} color={isPublic ? colors.primary : colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Public</Text>
                  <Text style={styles.optionSub}>Discoverable in Explore and search. Exact location shown to everyone.</Text>
                </View>
                <View style={[styles.radio, isPublic && styles.radioOn]} />
              </Pressable>
              <Pressable
                style={[styles.optionRow, !isPublic && styles.optionRowOn]}
                onPress={() => !premium && setIsPublic(false)}
                disabled={premium}
                testID="visibility-private"
              >
                <Lock size={18} color={!isPublic ? colors.primary : colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Private</Text>
                  <Text style={styles.optionSub}>Hidden from Explore. Only visible via share links you create.</Text>
                </View>
                <View style={[styles.radio, !isPublic && styles.radioOn]} />
              </Pressable>
            </View>

            {/* Show exact location (default for NEW links) */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Default for new share links</Text>
              <Pressable
                style={[
                  styles.toggleRow,
                  isPublic && styles.toggleRowDisabled,
                ]}
                onPress={() => !isPublic && setShowExact(v => !v)}
                disabled={isPublic}
                testID="visibility-exact-toggle"
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {showExact || isPublic
                      ? <Eye size={16} color={isPublic ? colors.textTertiary : colors.primary} />
                      : <EyeOff size={16} color={colors.textSecondary} />}
                    <Text style={[styles.toggleTitle, isPublic && { color: colors.textTertiary }]}>
                      Show exact location
                    </Text>
                  </View>
                  <Text style={styles.toggleSub}>
                    {isPublic
                      ? 'Public spots always show exact location to everyone — this option only applies when the spot is private.'
                      : showExact
                        ? 'New share links default to exact coords.'
                        : 'New share links default to approximate-area only (~1 km).'}
                  </Text>
                </View>
                <View style={[
                  styles.switchTrack,
                  (showExact || isPublic) && styles.switchTrackOn,
                  isPublic && styles.switchTrackDisabled,
                ]}>
                  <View style={[
                    styles.switchThumb,
                    (showExact || isPublic) && styles.switchThumbOn,
                  ]} />
                </View>
              </Pressable>
            </View>

            {/* Impact summary */}
            {dirty && impact.length > 0 ? (
              <View style={styles.impactBox} testID="visibility-impact">
                <Text style={styles.impactLabel}>What will change</Text>
                {impact.map((line, i) => (
                  <View key={i} style={styles.impactRow}>
                    <Text style={styles.impactBullet}>•</Text>
                    <Text style={styles.impactText}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (!dirty || busy || premium) && { opacity: 0.5 },
              ]}
              onPress={save}
              disabled={!dirty || busy || premium}
              testID="visibility-save"
            >
              {busy
                ? <ActivityIndicator color={colors.textInverse} />
                : <Text style={styles.primaryBtnText}>Save visibility</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    paddingHorizontal: space.xl, paddingTop: space.sm,
    maxHeight: '88%' },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: space.md },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingBottom: space.lg, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle, marginBottom: space.lg },
  title: { color: colors.text, fontSize: 19, fontWeight: '700' },
  sub: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },

  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    backgroundColor: '#3A2A00', borderRadius: radii.md, padding: space.md,
    marginBottom: space.lg },
  warnText: { color: colors.warning, flex: 1, fontSize: 12, lineHeight: 18 },

  errBox: { backgroundColor: '#3A1414', borderRadius: radii.md, padding: space.md, marginBottom: space.md },
  errText: { color: '#FCA5A5', fontSize: 14 },

  section: { marginBottom: space.lg },
  sectionLabel: {
    color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: space.sm },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface2, borderRadius: radii.md, padding: space.lg,
    marginBottom: space.sm, borderWidth: 1, borderColor: 'transparent' },
  optionRowOn: { borderColor: colors.primary },
  optionTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  optionSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 18 },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.border },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },

  toggleRow: {
    backgroundColor: colors.surface2, borderRadius: radii.md, padding: space.lg,
    flexDirection: 'row', alignItems: 'center', gap: space.md },
  toggleRowDisabled: { opacity: 0.55 },
  toggleTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  toggleSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 },

  switchTrack: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surface3,
    padding: 3, justifyContent: 'center' },
  switchTrackOn: { backgroundColor: colors.primary },
  switchTrackDisabled: { opacity: 0.5 },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  switchThumbOn: { transform: [{ translateX: 18 }] },

  impactBox: {
    backgroundColor: colors.surface2, borderRadius: radii.md, padding: space.lg,
    marginBottom: space.lg, borderLeftWidth: 3, borderLeftColor: colors.warning },
  impactLabel: {
    color: colors.warning, fontSize: 12, fontWeight: '700', marginBottom: space.sm },
  impactRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  impactBullet: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  impactText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 20 },

  primaryBtn: {
    backgroundColor: colors.primary, paddingVertical: 14,
    borderRadius: radii.lg, alignItems: 'center', marginTop: space.sm },
  primaryBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' } });
