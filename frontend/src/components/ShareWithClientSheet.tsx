/**
 * ShareWithClientSheet — Feature 4 (Scope B), bug-fix revision May 2026.
 *
 * UX bugs addressed:
 * 1. The active link URL was truncated with ellipsis and not selectable,
 *    so on iOS Safari / web preview a user had no way to read or
 *    long-press it as a fallback when Copy silently failed.
 *    → Replaced with a non-editable, selectable, multiline TextInput
 *      (RN's selectTextOnFocus + iOS long-press > Select All > Copy is
 *      the documented fallback path).
 * 2. Copy button gave zero feedback. → Per-link "✓ Copied" state + a
 *    transient toast bar at the bottom of the sheet.
 * 3. expo-clipboard alone is not reliable on every browser. → Three-tier
 *    fallback chain: expo-clipboard → web textarea + execCommand →
 *    focus + setSelection on the input (manual long-press copy).
 * 4. Native Share button rendered on desktop web where there is no
 *    navigator.share. → Gated on Platform.OS !== 'web' || 'share' in
 *    navigator.
 * 5. A "Cannot read properties of undefined (reading 'align')" runtime
 *    error was firing on sheet open. The culprit was a Pressable that
 *    passed a style array with a conditional `undefined` entry (RN-web
 *    flattens style arrays via deepMerge and crashes on undefined
 *    inside `align*` props). All conditional style entries now resolve
 *    to plain `false`/empty object, which RN flatten tolerates.
 * 6. expo-clipboard on iOS Safari requires the call to happen within
 *    the same synchronous user-activation tick as the press. The Copy
 *    onPress handler kicks off Clipboard.setStringAsync immediately —
 *    no awaited work runs before it — and uses .then/.catch so the
 *    transient activation is preserved.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView,
  ActivityIndicator, Share, Platform, Pressable, TextInput } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { X, Copy, Share2, Trash2, AlertTriangle, Eye, EyeOff, Plus, Check } from 'lucide-react-native';
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

// Web Share API availability gate. On native this is always true (the
// platform Share sheet is the real value). On web we only render the
// button when navigator.share actually exists — desktop Chrome/Firefox
// without it would otherwise no-op silently.
const SHARE_AVAILABLE = (() => {
  if (Platform.OS !== 'web') return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function';
  } catch {
    return false;
  }
})();

export default function ShareWithClientSheet({
  visible, onClose, spotId, spotTitle, spotIsPublic }: Props) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pre-generation state
  const [acknowledgedPrivacy, setAcknowledgedPrivacy] = useState(false);
  const [showExactLocation, setShowExactLocation] = useState(false);
  const [recentlyMintedToken, setRecentlyMintedToken] = useState<string | null>(null);
  // Jun 2025 — "Share Location" CR. Optional photographer-authored
  // personal note rendered above the spot details on the public,
  // white-themed client page. 600-char cap matches the backend.
  const [personalNote, setPersonalNote] = useState('');

  // Copy feedback — token of the link copied last, and a transient toast.
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs to each link's read-only URL TextInput so the fallback copy
  // chain can focus + select-all the input as a last resort.
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const flashToast = useCallback((msg: string, ms = 1800) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const markCopied = useCallback((token: string) => {
    setCopiedToken(token);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopiedToken(null), 1500);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get(`/spots/${spotId}/shares`);
      setLinks(r.items || []);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [spotId]);

  useEffect(() => {
    if (!visible) return;
    setRecentlyMintedToken(null);
    // Public spots — pre-acknowledge the privacy gate (it's a no-op).
    setAcknowledgedPrivacy(!!spotIsPublic);
    // Default exact-location: true for public spots, false for private.
    setShowExactLocation(!!spotIsPublic);
    setCopiedToken(null);
    setToast(null);
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
        personal_note: personalNote.trim() || undefined });
      setRecentlyMintedToken(r.token);
      // Reset note so the next mint doesn't accidentally inherit the
      // previous client's message.
      setPersonalNote('');
      await refresh();
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Three-tier copy fallback chain. CRITICAL: the FIRST clipboard call
   * happens synchronously inside the onPress handler so we don't lose
   * the iOS Safari transient user-activation that
   * navigator.clipboard.writeText requires.
   */
  const handleCopy = (link: ShareLink) => {
    const url = link.share_url;
    const token = link.token;

    // Tier 1: expo-clipboard. setStringAsync returns Promise<boolean>.
    // Kick it off synchronously and DO NOT await before this line.
    let primary: Promise<boolean>;
    try {
      primary = Clipboard.setStringAsync(url);
    } catch {
      primary = Promise.resolve(false);
    }

    primary
      .then((ok) => {
        if (ok !== false) {
          markCopied(token);
          flashToast('Link copied to clipboard');
          return;
        }
        webFallback(url, token);
      })
      .catch(() => webFallback(url, token));
  };

  const webFallback = (url: string, token: string) => {
    // Tier 2: hidden textarea + document.execCommand('copy'). Works on
    // older browsers and as a fallback when navigator.clipboard is
    // blocked (e.g. non-HTTPS preview, missing user-activation).
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, url.length);
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
          markCopied(token);
          flashToast('Link copied to clipboard');
          return;
        }
      } catch {
        // fall through to tier 3
      }
    }

    // Tier 3: focus the read-only input on the row and select all so
    // the user can long-press → Copy manually. Surface guidance via
    // toast so the user understands what to do.
    const ref = inputRefs.current[token];
    if (ref) {
      try {
        ref.focus();
        // On web RN-web TextInput exposes setSelection; on native
        // selectTextOnFocus already selected the whole content.
        const node = ref as unknown as { setSelection?: (s: number, e: number) => void };
        if (typeof node.setSelection === 'function') {
          node.setSelection(0, url.length);
        }
      } catch {
        /* ignored */
      }
    }
    flashToast('Tap and hold the link, then Copy', 2500);
  };

  const shareNative = async (link: ShareLink) => {
    if (!SHARE_AVAILABLE) {
      // Shouldn't normally be reached — the button is hidden when not
      // available — but guard defensively.
      handleCopy(link);
      return;
    }
    try {
      await Share.share({
        message: `${spotTitle} — shared via LumaScout\n${link.share_url}`,
        url: link.share_url });
    } catch {
      /* user dismissed */
    }
  };

  const confirmRevoke = (link: ShareLink) => {
    // Use a simple in-sheet confirmation instead of Alert.alert so
    // the action works on every platform (Alert.alert on web sometimes
    // no-ops in iframes). We use the toast helper to ask, then a
    // dedicated confirm-row.
    setPendingRevoke(link);
  };

  const [pendingRevoke, setPendingRevoke] = useState<ShareLink | null>(null);

  const actuallyRevoke = async () => {
    const link = pendingRevoke;
    if (!link) return;
    setPendingRevoke(null);
    try {
      await api.delete(`/spots/${spotId}/share/${link.token}`);
      // Jun 2025 — share-link revoke is now a HARD DELETE on the
      // backend. The row is gone from `spot_shares` and a
      // `share_link_audit_logs` entry was written before deletion.
      // Toast copy reflects the new semantics so creators understand
      // the action is final.
      flashToast('Share link revoked and deleted.');
      await refresh();
    } catch (e) {
      flashToast(formatApiError(e) || "Couldn't delete this share link. Please try again.", 2500);
    }
  };

  const showPrivacyGate = !spotIsPublic && !acknowledgedPrivacy;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Share Location</Text>
              <Text style={styles.sub} numberOfLines={1}>{spotTitle}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} testID="share-sheet-close" style={styles.closeBtn}>
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
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
                  Generating a link will let anyone with the URL view this location. By default
                  we&apos;ll show only an{' '}
                  <Text style={styles.bold}>approximate area</Text>
                  {' '}(2-decimal precision, ~1 km). You can toggle exact location next — that
                  choice locks in when the link is generated.
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
              <View>
                {/* Exact-location toggle (private spots only) */}
                {!spotIsPublic ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>New link settings</Text>
                    <Pressable
                      style={styles.toggleRow}
                      onPress={() => setShowExactLocation(v => !v)}
                      testID="share-exact-toggle"
                    >
                      <View style={styles.toggleRowText}>
                        <View style={styles.toggleRowHeading}>
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
                      <View style={[styles.switchTrack, showExactLocation ? styles.switchTrackOn : null]}>
                        <View style={[styles.switchThumb, showExactLocation ? styles.switchThumbOn : null]} />
                      </View>
                    </Pressable>
                    <Text style={styles.lockedNote}>
                      This setting is locked once the link is generated. To change it,
                      revoke the link and create a new one.
                    </Text>
                  </View>
                ) : null}

                {/* Jun 2025 — Personal note for the client. Rendered as a
                    magazine-style pull quote above the spot details on
                    the public, white-themed page recipients see. 600 char
                    cap mirrors the backend validation. */}
                <View style={styles.noteBlock}>
                  <Text style={styles.noteLabel}>Add a personal note (optional)</Text>
                  <TextInput
                    value={personalNote}
                    onChangeText={(t) => setPersonalNote(t.slice(0, 600))}
                    style={styles.noteInput}
                    placeholder="e.g. Hi Sarah — this location peaks in late April. Bring a change of outfits and water for the dogs."
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    maxLength={600}
                    testID="share-personal-note"
                  />
                  <Text style={styles.noteCounter}>{personalNote.length}/600</Text>
                </View>

                {/* Generate button */}
                <TouchableOpacity
                  style={[styles.primaryBtn, busy ? styles.btnBusy : null]}
                  onPress={mint}
                  disabled={busy}
                  testID="share-generate-btn"
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <View style={styles.btnInner}>
                      <Plus size={18} color={colors.textInverse} />
                      <Text style={styles.primaryBtnText}>Share via link</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* Active links */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    Active links {activeLinks.length ? `(${activeLinks.length})` : ''}
                  </Text>
                  {loading ? (
                    <ActivityIndicator color={colors.textSecondary} style={styles.loadingSpinner} />
                  ) : activeLinks.length === 0 ? (
                    <Text style={styles.emptyText}>No active links yet.</Text>
                  ) : (
                    activeLinks.map(link => (
                      <LinkRow
                        key={link.share_id}
                        link={link}
                        highlight={link.token === recentlyMintedToken}
                        justCopied={copiedToken === link.token}
                        shareAvailable={SHARE_AVAILABLE}
                        inputRef={(r) => { inputRefs.current[link.token] = r; }}
                        onCopy={() => handleCopy(link)}
                        onShare={() => shareNative(link)}
                        onRevoke={() => confirmRevoke(link)}
                        confirmingRevoke={pendingRevoke?.share_id === link.share_id}
                        onConfirmRevoke={actuallyRevoke}
                        onCancelRevoke={() => setPendingRevoke(null)}
                      />
                    ))
                  )}
                </View>

                {/* Revoked history */}
                {revokedLinks.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={styles.revokedHeader}>
                      Revoked ({revokedLinks.length})
                    </Text>
                    {revokedLinks.map(link => (
                      <View key={link.share_id} style={[styles.linkCard, styles.linkCardFaded]}>
                        <Text style={styles.linkUrlRevoked} numberOfLines={2}>{link.share_url}</Text>
                        <Text style={styles.revokedTag}>Revoked</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </ScrollView>

          {/* Toast — absolute at sheet bottom, lives above the safe area */}
          {toast ? (
            <View style={styles.toast} pointerEvents="none" testID="share-toast">
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function LinkRow({
  link, highlight, justCopied, shareAvailable, inputRef,
  onCopy, onShare, onRevoke,
  confirmingRevoke, onConfirmRevoke, onCancelRevoke }: {
  link: ShareLink;
  highlight: boolean;
  justCopied: boolean;
  shareAvailable: boolean;
  inputRef: (r: TextInput | null) => void;
  onCopy: () => void;
  onShare: () => void;
  onRevoke: () => void;
  confirmingRevoke: boolean;
  onConfirmRevoke: () => void;
  onCancelRevoke: () => void;
}) {
  return (
    <View style={[styles.linkCard, highlight ? styles.linkCardHighlight : null]}>
      <View style={styles.linkBadges}>
        <View style={styles.badge}>
          {link.show_exact_location
            ? <Eye size={11} color={colors.primary} />
            : <EyeOff size={11} color={colors.textSecondary} />}
          <Text style={styles.badgeText}>
            {link.show_exact_location ? 'Exact' : 'Approximate'}
          </Text>
        </View>
        {/* Jun 2025 — always show the view-count badge (Phase 1 spec
            calls for the basic view count to be visible at a glance,
            not hidden until the first view). Pluralizes correctly. */}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {link.access_count} view{link.access_count === 1 ? '' : 's'}
          </Text>
        </View>
      </View>

      {/* Selectable, read-only URL input. Wraps to 2 lines on narrow
          screens. iOS users can long-press → Select All → Copy as a
          guaranteed fallback even when the Copy button fails. */}
      <TextInput
        ref={inputRef}
        value={link.share_url}
        editable={false}
        multiline
        selectTextOnFocus
        numberOfLines={2}
        style={styles.urlInput}
        testID={`share-url-${link.share_id}`}
        // RN-web tolerates this; on native it's ignored.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...(Platform.OS === 'web' ? ({ readOnly: true } as any) : {})}
      />

      {!confirmingRevoke ? (
        <View style={styles.linkActions}>
          <TouchableOpacity
            style={[styles.linkBtn, justCopied ? styles.linkBtnCopied : null]}
            onPress={onCopy}
            testID={`share-copy-${link.share_id}`}
          >
            {justCopied
              ? <Check size={14} color={colors.success} />
              : <Copy size={14} color={colors.text} />}
            <Text style={[styles.linkBtnText, justCopied ? styles.linkBtnTextCopied : null]}>
              {justCopied ? 'Copied' : 'Copy'}
            </Text>
          </TouchableOpacity>

          {shareAvailable ? (
            <TouchableOpacity style={styles.linkBtn} onPress={onShare} testID={`share-share-${link.share_id}`}>
              <Share2 size={14} color={colors.text} />
              <Text style={styles.linkBtnText}>Share</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.linkBtn, styles.linkBtnDanger]}
            onPress={onRevoke}
            testID={`share-revoke-${link.share_id}`}
          >
            <Trash2 size={14} color={colors.secondary} />
            <Text style={[styles.linkBtnText, styles.linkBtnTextDanger]}>Revoke</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>
            Are you sure you want to revoke and permanently delete this share link? Anyone with this link will lose access immediately.
          </Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity style={styles.linkBtn} onPress={onCancelRevoke} testID={`share-revoke-cancel-${link.share_id}`}>
              <Text style={styles.linkBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.linkBtn, styles.linkBtnDanger]}
              onPress={onConfirmRevoke}
              testID={`share-revoke-confirm-${link.share_id}`}
            >
              <Trash2 size={14} color={colors.secondary} />
              <Text style={[styles.linkBtnText, styles.linkBtnTextDanger]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    maxHeight: '88%',
    minHeight: 320 },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: space.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    marginBottom: space.lg },
  headerText: { flex: 1, paddingRight: space.md },
  closeBtn: { padding: 4 },
  title: { color: colors.text, fontSize: 19, fontWeight: '700' },
  sub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  bold: { color: colors.text, fontWeight: '600' },

  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: space.xxxxl },

  errBox: {
    backgroundColor: '#3A1414',
    borderRadius: radii.md,
    padding: space.md,
    marginBottom: space.lg },
  errText: { color: '#FCA5A5', fontSize: 13, lineHeight: 18 },

  privacyGate: {
    alignItems: 'center',
    paddingVertical: space.xl,
    gap: space.md },
  privacyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#3A2A00',
    alignItems: 'center',
    justifyContent: 'center' },
  privacyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  privacyBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: space.md },

  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: space.xl,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
    minHeight: 48 },
  btnBusy: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  // Jun 2025 — Personal note input (rendered above Generate button)
  noteBlock: {
    marginTop: space.md,
    marginBottom: space.md,
  },
  noteLabel: {
    color: colors.text,
    fontSize: 12.5,
    fontFamily: font.bodySemibold,
    marginBottom: 8,
  },
  noteInput: {
    minHeight: 96,
    maxHeight: 180,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 19,
    textAlignVertical: 'top',
  },
  noteCounter: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 11,
    marginTop: 4,
    textAlign: 'right',
  },

  section: { marginTop: space.lg },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: space.sm },
  revokedHeader: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: space.sm },

  toggleRow: {
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    padding: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md },
  toggleRowText: { flex: 1 },
  toggleRowHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  toggleSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18 },
  lockedNote: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: space.sm,
    lineHeight: 16,
    fontStyle: 'italic' },

  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface3,
    padding: 3,
    justifyContent: 'center' },
  switchTrackOn: { backgroundColor: colors.primary },
  switchThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  switchThumbOn: { transform: [{ translateX: 18 }] },

  emptyText: {
    color: colors.textTertiary,
    fontSize: 14,
    paddingVertical: space.md },
  loadingSpinner: { marginTop: 12 },

  linkCard: {
    backgroundColor: colors.surface2,
    borderRadius: radii.md,
    padding: space.md,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: 'transparent' },
  linkCardHighlight: { borderColor: colors.primary },
  linkCardFaded: { opacity: 0.5 },
  linkBadges: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999 },
  badgeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },

  urlInput: {
    color: colors.text,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: space.sm,
    minHeight: 44,
    // Let the URL wrap to up to ~2 lines without truncation
    lineHeight: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    // Cross-platform user-select hint for web. Inline because RN doesn't
    // expose userSelect as a style. RN-web reads it via the JSX inline
    // style escape hatch.
    ...(Platform.OS === 'web' ? ({ userSelect: 'all', cursor: 'text' } as object) : {}) },
  linkUrlRevoked: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },

  linkActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface3,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.sm,
    minHeight: 44 },
  linkBtnCopied: { backgroundColor: 'rgba(16,185,129,0.12)' },
  linkBtnDanger: { backgroundColor: 'rgba(208,72,72,0.12)' },
  linkBtnText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  linkBtnTextCopied: { color: colors.success },
  linkBtnTextDanger: { color: colors.secondary },

  confirmRow: {
    backgroundColor: colors.surface3,
    borderRadius: radii.sm,
    padding: space.md },
  confirmText: { color: colors.text, fontSize: 13, marginBottom: space.sm, lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },

  revokedTag: {
    color: colors.secondary,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4 },

  toast: {
    position: 'absolute',
    bottom: space.xl,
    left: space.xl,
    right: space.xl,
    backgroundColor: '#1F1F22',
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border },
  toastText: { color: colors.text, fontSize: 13, fontWeight: '600' } });
