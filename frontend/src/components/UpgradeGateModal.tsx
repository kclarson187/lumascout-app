import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { X, Crown, Check, Sparkles } from 'lucide-react-native';
import { colors, font, radii, space } from '../theme';

/**
 * UpgradeGateModal
 *
 * A reusable gate that pops up when a Free user attempts an action their plan
 * doesn't allow (save limit reached, advanced filter, private spot cap, etc.).
 *
 * Philosophy (PRD item #5):
 *   • Never hard-block — explain *why*, preview value, offer upgrade.
 *   • Stay in-context: bottom-sheet style, spot's screen stays visible behind
 *     the scrim so the user can cancel and keep browsing.
 *   • Route directly to /paywall?reason=<reason> so the pricing page can
 *     localize its headline and highlight the correct plan.
 *   • Single source of truth for per-reason copy — centralised `REASONS` map.
 */

export type GateReason =
  | 'saves'
  | 'collections'
  | 'filters'
  | 'private'
  | 'ai_planner'
  | 'messaging'
  | 'analytics'
  | 'uploads'
  | 'routes'
  | 'viewers'
  | 'spot_packs'
  | 'referrals'
  | 'generic';

type ReasonConfig = {
  title: string;
  body: string;
  perks: string[];
  targetPlan?: 'pro' | 'elite';
};

const REASONS: Record<GateReason, ReasonConfig> = {
  saves: {
    title: 'You\'ve hit your save limit',
    body: 'Free accounts can save 3 spots. Pro photographers build unlimited lists for every shoot style and location.',
    perks: [
      'Unlimited saved spots',
      'Custom collections for every shoot day',
      'Advanced filters to find the perfect spot',
    ],
    targetPlan: 'pro',
  },
  collections: {
    title: 'Custom collections are a Pro feature',
    body: 'Free accounts get one Saved list. Go Pro to organise spots into themed collections — bridal locations, urban golden hour, winter backdrops.',
    perks: [
      'Unlimited named collections',
      'Share collections with clients',
      'Export a shoot-day itinerary',
    ],
    targetPlan: 'pro',
  },
  filters: {
    title: 'Advanced filters are a Pro feature',
    body: 'Filter by crowd level, permit status, accessibility, shoot score, and golden-hour windows — in seconds.',
    perks: [
      '12+ advanced filter dimensions',
      'Save filter presets',
      'Map overlays: weather, crowd, fee zones',
    ],
    targetPlan: 'pro',
  },
  private: {
    title: 'Your private vault is full',
    body: 'Free keeps 1 private spot. Pro lets you log every hidden gem, parking pull-off, and client-session address.',
    perks: [
      'Unlimited private spots',
      'Attach client names and notes',
      'Hidden from the public map — ever',
    ],
    targetPlan: 'pro',
  },
  ai_planner: {
    title: 'Scout AI Planner is an Elite feature',
    body: 'Generate personalised shoot-day itineraries with driving routes, light windows, and weather — built from real LumaScout spots.',
    perks: [
      'Weekend itinerary builder',
      'Theme-matched collection generator',
      'Route optimisation with golden-hour timing',
    ],
    targetPlan: 'elite',
  },
  messaging: {
    title: 'You\'ve used your free message threads',
    body: 'Free accounts can start 3 new photographer DMs per month. Replies on existing threads are always free. Go Pro to message anyone, anytime.',
    perks: [
      'Unlimited new photographer DMs',
      'Read receipts and typing indicators',
      'Priority on the referral board',
    ],
    targetPlan: 'pro',
  },
  analytics: {
    title: 'Creator analytics are a Pro feature',
    body: 'See exactly who is viewing your spots, which cities your work is reaching, and what\'s trending in your region.',
    perks: [
      'Full "Who viewed my profile" list',
      '30-day view + save analytics',
      'Exportable monthly creator report',
    ],
    targetPlan: 'pro',
  },
  uploads: {
    title: 'You\'ve hit your upload limit',
    body: 'Free accounts can upload 5 spots total. Pro creators contribute as much as they want — and unlock spot analytics, featured rotation, and the Pro badge.',
    perks: [
      'Unlimited public + private uploads',
      'Pro creator badge on every spot',
      'See who saves and views your work',
    ],
    targetPlan: 'pro',
  },
  routes: {
    title: 'Plan more than one route',
    body: 'Free accounts can keep one active route. Pro photographers plan a full week of shoots — multi-city trips, client tours, golden-hour itineraries.',
    perks: [
      'Unlimited active routes',
      'Multi-day shoot itineraries',
      'Optimise driving + light timing',
    ],
    targetPlan: 'pro',
  },
  viewers: {
    title: 'See who viewed your profile',
    body: 'Free accounts see a teaser. Pro photographers see the full list of who\'s checking out their work — and use it to land referrals.',
    perks: [
      'Full unblurred Profile Viewers list',
      'Filter by location and follower status',
      '30-day view analytics',
    ],
    targetPlan: 'pro',
  },
  spot_packs: {
    title: 'Spot Packs are an Elite feature',
    body: 'Package your best locations into premium, sellable Spot Packs. Elite creators turn local knowledge into recurring revenue.',
    perks: [
      'Publish curated sellable Spot Packs',
      'Elite creator badge + featured rotation',
      'Monthly payouts via Stripe Connect',
    ],
    targetPlan: 'elite',
  },
  referrals: {
    title: 'Apply to more referrals',
    body: 'Free accounts get a limited number of applications per month. Pro photographers apply to every opportunity that fits their schedule.',
    perks: [
      'Unlimited referral applications',
      'Direct DM with the poster',
      'Priority visibility in the applicant list',
    ],
    targetPlan: 'pro',
  },
  generic: {
    title: 'Unlock the full LumaScout',
    body: 'Pro photographers get the serious scouting tools — unlimited saves, custom collections, advanced filters, and unlimited DMs.',
    perks: [
      'Unlimited saves, collections, uploads',
      'Advanced filters and full Profile Viewers',
      'Unlimited photographer DMs',
    ],
    targetPlan: 'pro',
  },
};

export default function UpgradeGateModal({
  visible,
  onClose,
  reason = 'generic',
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  reason?: GateReason;
  testID?: string;
}) {
  const cfg = REASONS[reason] || REASONS.generic;
  const tierName = cfg.targetPlan === 'elite' ? 'Elite' : 'Pro';

  const goUpgrade = () => {
    onClose();
    // Route to the full paywall with the reason so the pricing copy matches.
    router.push({ pathname: '/paywall', params: { reason } });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={testID || 'upgrade-gate-modal'}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop propagation by eating touches on the sheet itself. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <LinearGradient
            colors={['rgba(245,166,35,0.10)', 'transparent']}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} testID="upgrade-gate-close">
            <X size={18} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.crownWrap}>
            <Crown size={28} color={colors.primary} />
          </View>
          <Text style={styles.title}>{cfg.title}</Text>
          <Text style={styles.body}>{cfg.body}</Text>

          <View style={styles.perks}>
            {cfg.perks.map((p) => (
              <View key={p} style={styles.perkRow}>
                <View style={styles.perkDot}>
                  <Check size={12} color={colors.textInverse} strokeWidth={3} />
                </View>
                <Text style={styles.perkTxt}>{p}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.ctaPrimary}
            onPress={goUpgrade}
            testID="upgrade-gate-cta"
            activeOpacity={0.85}
          >
            <Sparkles size={14} color={colors.textInverse} />
            <Text style={styles.ctaPrimaryTxt}>See {tierName} plans</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.dismiss} testID="upgrade-gate-dismiss">
            <Text style={styles.dismissTxt}>Not now</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Lightweight hook for screens that need to trigger the gate imperatively.
 * Usage:
 *   const gate = useUpgradeGate();
 *   gate.show('saves'); // on failed save attempt
 *   <gate.Modal /> // mounted near the screen root
 */
export function useUpgradeGate() {
  const [state, setState] = React.useState<{ visible: boolean; reason: GateReason }>({
    visible: false,
    reason: 'generic',
  });
  const show = (reason: GateReason = 'generic') => setState({ visible: true, reason });
  const hide = () => setState((s) => ({ ...s, visible: false }));
  const Comp = () => (
    <UpgradeGateModal visible={state.visible} onClose={hide} reason={state.reason} />
  );
  return { show, hide, Modal: Comp };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.xxl + space.sm,
    gap: space.md,
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  crownWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.4)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 26,
    letterSpacing: -0.3,
    lineHeight: 30,
  },
  body: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 21,
  },
  perks: {
    gap: 10,
    marginTop: space.sm,
    marginBottom: space.md,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  perkDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkTxt: {
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 14,
    flex: 1,
  },
  ctaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radii.pill,
  },
  ctaPrimaryTxt: {
    color: colors.textInverse,
    fontFamily: font.bodyBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
  dismiss: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  dismissTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 13,
  },
});
