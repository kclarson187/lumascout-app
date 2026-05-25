/**
 * ShareWithClientSheet — Feature 4 (Scope B).
 *
 * Bottom sheet the owner / admin opens from the spot detail screen to:
 *   1. (PRIVATE spots only) see the privacy notice and explicitly tap to
 *      proceed before any token is minted.
 *   2. Optionally toggle "Show exact location" — per-link, IMMUTABLE
 *      once the link is generated. This matches the backend contract.
 *   3. Mint a new share link (calls POST /api/spots/{id}/share).
 *   4. View existing active links with copy + native share + revoke.
 *
 * The exact-location toggle is hidden / forced-true for public spots
 * (the recipient is going to see exact coords either way; toggling
 * "approximate" on a public spot is meaningless and we don't surface
 * the option). For private spots the toggle defaults to OFF so a new
 * link is approximate-only unless the owner explicitly opts in.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView,
  ActivityIndicator, Share, Alert, Platform, Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { X, Link2, Copy, Share2, Trash2, AlertTriangle, Eye, EyeOff, Plus } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import { api, formatApiError } from '../api';

export type ShareLink = {
  share_id: string;
  token: string;
  share_url: string;
  label: string | null;
  revoked: boolean;
  revoked_at: string | null;
  created_at: string;
  show_exact_location: boolean;
  spot_visibility_at_create: 'public' | 'private' | null;
  access_count: number;
  last_accessed_at: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  spotId: string;
  spotTitle: string;
  spotIsPublic: boolean;
};

export default function ShareWithClientSheet({
  visible, onClose, spotId, spotTitle, spotIsPublic,
}: Props) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pre-generation state
  const [acknowledgedPrivacy, setAcknowledgedPrivacy] = useState(false);
  const [showExactLocation, setShowExactLocation] = useState(false);
  const [recentlyMintedToken, setRecentlyMintedToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get(`/spots/${spotId}/shares`);
      setLinks(r.items || []);
    } catch (e: any) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [spotId]);

  useEffect(() => {
    if (!visible) return;
    setRecentlyMintedToken(null);
    // For public spots the privacy step is a no-op so we pre-acknowledge.
    setAcknowledgedPrivacy(spotIsPublic);
    // Default exact-location to true if public, false if private.
    setShowExactLocation(spotIsPublic);
    refresh();
  }, [visible, spotIsPublic, refresh]);

  const activeLinks = useMemo(() => links.filter(l => !l.revoked), [links]);
  const revokedLinks = useMemo(() => links.filter(l => l.revoked), [links]);

  const mint = async () => {
    if (!acknowledgedPrivacy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/spots/${spotId}/share`, {
        show_exact_location: showExactLocation,
      });
      setRecentlyMintedToken(r.token);
      await refresh();
    } catch (e: any) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await Clipboard.setStringAsync(url);
      Alert.alert('Copied', 'Share link copied to clipboard.');
    } catch {
      Alert.alert('Could not copy', 'Try again.');
    }
  };

  const shareNative = async (url: string) => {
    try {
      await Share.share({
        message: `${spotTitle} — shared via LumaScout\n${url}`,
        url,
      });
    } catch { /* user dismissed */ }
  };

  const confirmRevoke = (link: ShareLink) => {
    Alert.alert(
      'Revoke this link?',
      'Anyone who already has it will see "Link unavailable" the next time they open it. This can\'t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/spots/${spotId}/share/${link.token}`);
              await refresh();
            } catch (e: any) {
              Alert.alert('Could not revoke', formatApiError(e));
            }
          },
        },
      ],
    );
  };

  const showPrivacyGate = !spotIsPublic && !acknowledgedPrivacy;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Share with client</Text>
              <Text style={styles.sub} numberOfLines={1}>{spotTitle}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} testID="share-sheet-close">
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: space.xxxl }}
            keyboardShouldPersistTaps="handled"
          >
            {err ? (
              <View style={styles.errBox}><Text style={styles.errText}>{err}</Text></View>
            ) : null}

            {showPrivacyGate ? (
              <View style={styles.privacyGate} testID="share-privacy-gate">
                <View style={styles.privacyIcon}>
                  <AlertTriangle size={28} color={colors.warning} />
                </View>
                <Text style={styles.privacyTitle}>This is a private spot</Text>
                <Text style={styles.privacyBody}>
                  Generating a link will let anyone with the URL view this
                  location. By default we'll show only an{' '}
                  <Text style={{ color: colors.text, fontWeight: '600' }}>approximate area</Text>
                  {' '}(2-decimal precision, ~1 km). You can toggle exact
                  location on next — that choice locks in when you generate
                  the link.
                </Text>
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => setAcknowledgedPrivacy(true)}
                  testID="share-privacy-ack"
                >
                  <Text style={styles.primaryBtnText}>Continue</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Exact-location toggle (private spots only) */}
                {!spotIsPublic ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>New link settings</Text>
                    <Pressable
                      style={styles.toggleRow}
                      onPress={() => setShowExactLocation(v => !v)}
                      testID="share-exact-toggle"
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          {showExactLocation
                            ? <Eye size={16} color={colors.primary} />
                            : <EyeOff size={16} color={colors.textSecondary} />}
                          <Text style={styles.toggleTitle}>Show exact location</Text>
                        </View>
                        <Text style={styles.toggleSub}>
                          {showExactLocation
                            ? 'Recipient will see the precise pin and address.'
                            : 'Recipient sees only an approximate area (2-decimal coords).'}
                        </Text>
                      </View>
                      <View style={[styles.switchTrack, showExactLocation && styles.switchTrackOn]}>
                        <View style={[styles.switchThumb, showExactLocation && styles.switchThumbOn]} />
                      </View>
                    </Pressable>
                    <Text style={styles.lockedNote}>
                      This setting is locked once the link is generated. To
                      change it, revoke the link and create a new one.
                    </Text>
                  </View>
                ) : null}

                {/* Generate button */}
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                  onPress={mint}
                  disabled={busy}
                  testID="share-generate-btn"
                >
                  {busy
                    ? <ActivityIndicator color={colors.textInverse} />
                    : <>
                        <Plus size={18} color={colors.textInverse} />
                        <Text style={styles.primaryBtnText}>Generate share link</Text>
                      </>}
                </TouchableOpacity>

                {/* Active links */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    Active links {activeLinks.length ? `(${activeLinks.length})` : ''}
                  </Text>
                  {loading ? (
                    <ActivityIndicator color={colors.textSecondary} style={{ marginTop: 12 }} />
                  ) : activeLinks.length === 0 ? (
                    <Text style={styles.emptyText}>No active links yet.</Text>
                  ) : (
                    activeLinks.map(link => (
                      <LinkRow
                        key={link.share_id}
                        link={link}
                        highlight={link.token === recentlyMintedToken}
                        onCopy={() => copyLink(link.share_url)}
                        onShare={() => shareNative(link.share_url)}
                        onRevoke={() => confirmRevoke(link)}
                      />
                    ))
                  )}
                </View>

                {/* Revoked history */}
                {revokedLinks.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
                      Revoked ({revokedLinks.length})
                    </Text>
                    {revokedLinks.map(link => (
                      <View key={link.share_id} style={[styles.linkCard, { opacity: 0.5 }]}>
                        <Text style={styles.linkUrl} numberOfLines={1}>{link.share_url}</Text>
                        <Text style={styles.revokedTag}>Revoked</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function LinkRow({
  link, highlight, onCopy, onShare, onRevoke,
}: {
  link: ShareLink;
  highlight: boolean;
  onCopy: () => void;
  onShare: () => void;
  onRevoke: () => void;
}) {
  return (
    <View style={[styles.linkCard, highlight && styles.linkCardHighlight]}>
      <View style={styles.linkBadges}>
        <View style={styles.badge}>
          {link.show_exact_location
            ? <Eye size={11} color={colors.primary} />
            : <EyeOff size={11} color={colors.textSecondary} />}
          <Text style={styles.badgeText}>
            {link.show_exact_location ? 'Exact' : 'Approximate'}
          </Text>
        </View>
        {link.access_count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{link.access_count} views</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.linkUrl} numberOfLines={1}>{link.share_url}</Text>
      <View style={styles.linkActions}>
        <TouchableOpacity style={styles.linkBtn} onPress={onCopy} testID={`share-copy-${link.share_id}`}>
          <Copy size={14} color={colors.text} />
          <Text style={styles.linkBtnText}>Copy</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={onShare}>
          <Share2 size={14} color={colors.text} />
          <Text style={styles.linkBtnText}>Share</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.linkBtn, styles.linkBtnDanger]} onPress={onRevoke} testID={`share-revoke-${link.share_id}`}>
          <Trash2 size={14} color={colors.secondary} />
          <Text style={[styles.linkBtnText, { color: colors.secondary }]}>Revoke</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    paddingHorizontal: space.xl, paddingTop: space.sm,
    maxHeight: '88%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, alignSelf: 'center', marginBottom: space.md,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingBottom: space.lg, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle, marginBottom: space.lg,
  },
  title: { color: colors.text, fontSize: 19, fontWeight: '700' },
  sub: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },

  errBox: { backgroundColor: '#3A1414', borderRadius: radii.md, padding: space.md, marginBottom: space.lg },
  errText: { color: '#FCA5A5', fontSize: 14 },

  privacyGate: { alignItems: 'center', paddingVertical: space.xl, gap: space.md },
  privacyIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#3A2A00', alignItems: 'center', justifyContent: 'center',
  },
  privacyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  privacyBody: {
    color: colors.textSecondary, fontSize: 14, lineHeight: 22,
    textAlign: 'center', paddingHorizontal: space.md,
  },

  primaryBtn: {
    backgroundColor: colors.primary, paddingVertical: 14, paddingHorizontal: space.xl,
    borderRadius: radii.lg, alignItems: 'center', flexDirection: 'row',
    justifyContent: 'center', gap: 8, marginTop: space.sm,
  },
  primaryBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },

  section: { marginTop: space.lg },
  sectionLabel: {
    color: colors.textSecondary, fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.sm,
  },

  toggleRow: {
    backgroundColor: colors.surface2, borderRadius: radii.md, padding: space.lg,
    flexDirection: 'row', alignItems: 'center', gap: space.md,
  },
  toggleTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  toggleSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 },
  lockedNote: {
    color: colors.textTertiary, fontSize: 12,
    marginTop: space.sm, lineHeight: 16, fontStyle: 'italic',
  },

  switchTrack: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surface3,
    padding: 3, justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: colors.primary },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  switchThumbOn: { transform: [{ translateX: 18 }] },

  emptyText: { color: colors.textTertiary, fontSize: 14, paddingVertical: space.md },

  linkCard: {
    backgroundColor: colors.surface2, borderRadius: radii.md, padding: space.md,
    marginBottom: space.sm, borderWidth: 1, borderColor: 'transparent',
  },
  linkCardHighlight: { borderColor: colors.primary },
  linkBadges: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surface3, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  linkUrl: {
    color: colors.text, fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: space.sm,
  },
  linkActions: { flexDirection: 'row', gap: space.sm },
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface3, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.sm, minHeight: 36,
  },
  linkBtnDanger: { backgroundColor: 'rgba(208,72,72,0.12)' },
  linkBtnText: { color: colors.text, fontSize: 12, fontWeight: '600' },

  revokedTag: { color: colors.secondary, fontSize: 11, fontWeight: '700', marginTop: 4 },
});
