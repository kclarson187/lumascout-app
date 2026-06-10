/**
 * PostSaveSpotSheet — Phase 2 (Add Location Optimization, Jun 2026).
 *
 * Upgraded post-submission success screen. Shown after a successful
 * spot submission with a preview card, primary actions, and a subtle
 * upgrade prompt for Free users.
 *
 * Branches:
 *   • Park child  → "Add another spot in this park" still primary
 *   • Standalone  → Submitted for Review + preview + actions
 *
 * Actions (standalone):
 *   • View spot         — only when newSpotId present
 *   • Add another spot  — keeps user in the contribution loop
 *   • View my uploads   — quick jump to profile uploads tab
 *   • Share LumaScout   — referral driver
 *   • Subtle upgrade   — Free-tier only, dismissable
 *
 * Park-child retains the original quick-add flow but with the same
 * polished success header.
 */
import React from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Pressable, Platform,
  Image, ScrollView,
} from 'react-native';
import { MapPin, Plus, Check, Eye, X, Share2, Sparkles, Folder, Crown } from 'lucide-react-native';
import { colors, font, space, radii } from '../theme';
import { shareApp } from '../utils/share';

type Props = {
  visible: boolean;
  parkName?: string | null;
  parkId?: string | null;
  newSpotId?: string | null;
  // Phase 2 — preview card data
  spotTitle?: string | null;
  spotCity?: string | null;
  spotState?: string | null;
  coverImageUrl?: string | null;
  // Visibility hint: "public"/"premium" → "Submitted for Review"
  // "private"/"followers" → "Posted privately"
  visibilityStatus?: 'pending_review' | 'approved' | 'draft' | string | null;
  // Tier — used to decide the upgrade nudge
  userTier?: 'anon' | 'free' | 'pro' | 'elite';

  onAddAnother: () => void;
  onViewPark: () => void;
  onViewSpot: () => void;
  onSaveAndClose: () => void;
  onEndSession: () => void;
  onViewMyUploads?: () => void;
  onUpgradePress?: () => void;
  onClose: () => void;
};

export default function PostSaveSpotSheet({
  visible, parkName, parkId, newSpotId,
  spotTitle, spotCity, spotState, coverImageUrl, visibilityStatus,
  userTier,
  onAddAnother, onViewPark, onViewSpot, onSaveAndClose, onEndSession,
  onViewMyUploads, onUpgradePress, onClose,
}: Props) {
  const isParkChild = !!parkId && !!parkName;
  const pendingReview = visibilityStatus === 'pending_review';
  const headline = pendingReview ? 'Submitted for Review' : 'Spot saved';
  const subhead = isParkChild
    ? `Added to ${parkName}`
    : pendingReview
      ? "We'll let you know once moderation clears it — usually under 24h."
      : 'Your spot is live.';

  const showUpgrade = userTier === 'free' && !isParkChild;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        {/* ── Header ── */}
        <View style={styles.headerRow}>
          <View style={styles.checkIcon}>
            <Check size={20} color={colors.textInverse} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{headline}</Text>
            <Text style={styles.subtitle} numberOfLines={2}>{subhead}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="postsave-close">
            <X size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ maxHeight: 460 }}
          contentContainerStyle={{ paddingBottom: 4 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Preview card ── (standalone only — keeps park-child compact) */}
          {!isParkChild && (spotTitle || coverImageUrl) && (
            <View style={styles.previewCard}>
              {coverImageUrl ? (
                <Image source={{ uri: coverImageUrl }} style={styles.previewImg} resizeMode="cover" />
              ) : (
                <View style={[styles.previewImg, styles.previewImgFallback]}>
                  <MapPin size={20} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.previewMeta}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {spotTitle || 'Untitled spot'}
                </Text>
                {(spotCity || spotState) && (
                  <Text style={styles.previewLoc} numberOfLines={1}>
                    {[spotCity, spotState].filter(Boolean).join(', ')}
                  </Text>
                )}
                {pendingReview && (
                  <View style={styles.previewBadge}>
                    <Sparkles size={10} color={colors.primary} />
                    <Text style={styles.previewBadgeTxt}>Pending review</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ── Actions ── */}
          {isParkChild ? (
            <View style={{ gap: 8, marginTop: space.md }}>
              <TouchableOpacity style={styles.primaryBtn} onPress={onAddAnother} testID="postsave-add-another">
                <Plus size={18} color={colors.textInverse} />
                <Text style={styles.primaryBtnTxt}>
                  Add another spot in {parkName}
                </Text>
              </TouchableOpacity>

              <View style={styles.rowBtns}>
                <TouchableOpacity style={styles.ghostBtn} onPress={onViewPark} testID="postsave-view-park">
                  <MapPin size={15} color={colors.text} />
                  <Text style={styles.ghostBtnTxt}>View park</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} onPress={onSaveAndClose} testID="postsave-save-close">
                  <Check size={15} color={colors.text} />
                  <Text style={styles.ghostBtnTxt}>Save & close</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.endBtn} onPress={onEndSession} testID="postsave-end-session">
                <Text style={styles.endBtnTxt}>End park session</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ gap: 8, marginTop: space.md }}>
              {/* Primary: View Spot (only when we have id and it's approved). For
                  pending_review spots, push them to keep contributing instead. */}
              {newSpotId && !pendingReview && (
                <TouchableOpacity style={styles.primaryBtn} onPress={onViewSpot} testID="postsave-view-spot">
                  <Eye size={18} color={colors.textInverse} />
                  <Text style={styles.primaryBtnTxt}>View spot</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={pendingReview ? styles.primaryBtn : styles.ghostBtnWide}
                onPress={onAddAnother}
                testID="postsave-add-another-standalone"
              >
                <Plus size={pendingReview ? 18 : 15} color={pendingReview ? colors.textInverse : colors.text} />
                <Text style={pendingReview ? styles.primaryBtnTxt : styles.ghostBtnTxt}>
                  Add another spot
                </Text>
              </TouchableOpacity>

              <View style={styles.rowBtns}>
                {onViewMyUploads && (
                  <TouchableOpacity style={styles.ghostBtn} onPress={onViewMyUploads} testID="postsave-view-uploads">
                    <Folder size={15} color={colors.text} />
                    <Text style={styles.ghostBtnTxt}>My uploads</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.ghostBtn}
                  onPress={() => { shareApp().catch(() => {}); }}
                  testID="postsave-share-app"
                >
                  <Share2 size={15} color={colors.text} />
                  <Text style={styles.ghostBtnTxt}>Share LumaScout</Text>
                </TouchableOpacity>
              </View>

              {/* Optional upgrade nudge — Free only */}
              {showUpgrade && onUpgradePress && (
                <TouchableOpacity
                  style={styles.upgradeNudge}
                  onPress={onUpgradePress}
                  testID="postsave-upgrade"
                >
                  <View style={styles.upgradeIcon}>
                    <Crown size={14} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.upgradeTitle}>Unlock premium scouting</Text>
                    <Text style={styles.upgradeSub} numberOfLines={2}>
                      Unlimited uploads, premium pins, and full WeatherKit data.
                    </Text>
                  </View>
                  <Text style={styles.upgradeCta}>See plans</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.endBtn} onPress={onSaveAndClose} testID="postsave-done">
                <Text style={styles.endBtnTxt}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: space.xl, paddingBottom: Platform.OS === 'ios' ? 32 : space.xl,
    borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    maxHeight: '92%',
  },
  handle: {
    alignSelf: 'center',
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 20, letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, marginTop: 2, lineHeight: 18 },

  // Preview card
  previewCard: {
    marginTop: space.md,
    flexDirection: 'row', gap: 12,
    padding: 10, borderRadius: radii.lg,
    backgroundColor: colors.surface1,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    alignItems: 'center',
  },
  previewImg: {
    width: 72, height: 72, borderRadius: 10,
    backgroundColor: colors.surface2,
  },
  previewImgFallback: { alignItems: 'center', justifyContent: 'center' },
  previewMeta: { flex: 1, gap: 2 },
  previewTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  previewLoc: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(245,166,35,0.40)',
    marginTop: 6,
  },
  previewBadgeTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: radii.md,
    backgroundColor: colors.primary,
    minHeight: 48,
  },
  primaryBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },

  rowBtns: { flexDirection: 'row', gap: 8 },
  ghostBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    minHeight: 44,
  },
  ghostBtnWide: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    minHeight: 44,
  },
  ghostBtnTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },

  // Upgrade nudge
  upgradeNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
    marginTop: 4,
  },
  upgradeIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  upgradeTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  upgradeSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11.5, marginTop: 2, lineHeight: 15 },
  upgradeCta: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, marginLeft: 4 },

  endBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  endBtnTxt: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 12 },
});
