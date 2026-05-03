/**
 * spot-detail/styles.ts
 * ─────────────────────
 *
 * StyleSheet extracted from `app/spot/[id].tsx` on 2026-05-03 as part
 * of the v2.0.25 spot-detail refactor. The source file had grown to
 * ~1700 lines with a 350-line StyleSheet hanging off the bottom,
 * which made the component itself hard to scan for logic changes.
 *
 * Rules for this file
 * ───────────────────
 *   • NO JSX, NO React hooks. Just style primitives + constants.
 *   • Exported as `styles` and `sadStyles` — identical shape to the
 *     old module-local objects. Callers should `import { styles,
 *     sadStyles }` instead of re-declaring.
 *   • The `W` device-width constant is exported too so any spot-
 *     detail atom/section that needs it (hero sizing) can pull
 *     from a single source.
 *
 * Why two StyleSheets (`styles` + `sadStyles`)?
 * ─────────────────────────────────────────────
 * `sadStyles` was added later for the destructive-action treatment
 * (the super-admin Delete Spot danger zone and photo-manager card).
 * Kept separate so the "sad" red palette lives in one spot and
 * can't accidentally bleed into the happy-path UI.
 */
import { Dimensions, StyleSheet } from 'react-native';
import { colors, font, space, radii } from '../../theme';

export const { width: W } = Dimensions.get('window');

export const styles = StyleSheet.create({
  heroWrap: { width: W, height: W, position: 'relative', backgroundColor: colors.surface2 },
  heroImg: { width: W, height: W },
  heroGradTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  heroGradBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 },
  heroHead: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.sm,
  },
  headBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  headBtnAdmin: {
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  dots: {
    position: 'absolute', bottom: space.md, alignSelf: 'center',
    flexDirection: 'row', gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 20, backgroundColor: colors.primary },
  // CR #1 Item 2 (June 2025): minimal "2 / 6" hero counter. Replaces
  // the dot rail so the gallery feels premium and glanceable at a
  // glance — no cognitive load counting dots on 10-image galleries.
  heroCounter: {
    position: 'absolute',
    bottom: space.md,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  heroCounterTxt: {
    color: '#fff',
    fontFamily: font.bodySemibold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  // Hero Carousel CR (June 2025 v2.0.20) — community attribution pill.
  // Bottom-left corner, well clear of the admin DELETE pill (which
  // sits at bottom: space.lg + 16, left: space.md). We position
  // ours at bottom: space.md, left: space.md so when both happen
  // to coexist on the same slide (community photo + admin) the
  // attribution chip sits BELOW the delete pill. In the more common
  // case (no admin) it sits cleanly in the bottom-left corner.
  heroCommunityPill: {
    position: 'absolute',
    bottom: space.md,
    left: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
    maxWidth: '70%',
  },
  heroCommunityPillTxt: {
    color: '#fff',
    fontFamily: font.bodySemibold,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  // May 2026 batch #4 update #2.1 — admin photo DELETE pill.
  //
  // Moved from top-right to BOTTOM-LEFT (May 2026) so it never
  // collides with the share / report / wand / bookmark buttons in
  // the header row. Positioned above the dots indicator with an extra
  // 12px margin so the two don't compete visually.
  //
  // Clean + professional: slightly smaller pill (32px high), softer
  // red (#dc2626 at 92% alpha), tighter typography. Hairline white
  // border + subtle drop shadow lift it off any photo.
  photoDeletePill: {
    position: 'absolute',
    bottom: space.lg + 16,      // above the dots row
    left: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  photoDeletePillTxt: {
    color: '#fff',
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 0.9,
  },
  // ADMIN context tag — mirrored on BOTTOM-RIGHT. Gold-tinted,
  // informational only (non-tappable). Height matched to the pill
  // so both sit cleanly on the same baseline above the dots row.
  photoAdminTag: {
    position: 'absolute',
    bottom: space.lg + 16,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,166,35,0.45)',
  },
  photoAdminTagTxt: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
  },
  content: { padding: space.xl, gap: 6 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 32, letterSpacing: -0.5, lineHeight: 38 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  meta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  onSiteBadge: {
    alignSelf: 'flex-start', marginTop: 6,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: '#16a34a',
  },
  onSiteBadgeTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  tag: { backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  tagText: { color: colors.text, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  // PRD #3 Golden-hour window
  goldenWindow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: space.md,
    paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.38)', borderWidth: 1,
    borderRadius: radii.md,
  },
  goldenIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(245,166,35,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  goldenTitle: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 15, letterSpacing: 0.2 },
  goldenSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  // May 2026 — Best light notes card (primary: shown when `best_light_notes`
  // exists). Intentionally softer than the golden-hour window: this is
  // uploader-authored prose about *how the light behaves at this spot*
  // (e.g. "Sidelight from 8-10am hits the east cliff face; shadow falls
  // after noon"), so we use a neutral info-card treatment rather than the
  // high-contrast amber of the daily golden-hour computation.
  bestLightCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    marginTop: space.md,
    paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md,
  },
  bestLightIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  bestLightLabel: {
    color: colors.textSecondary, fontFamily: font.bodyMedium,
    fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  bestLightBody: {
    color: colors.text, fontFamily: font.body,
    fontSize: 14, lineHeight: 20, marginTop: 3,
  },
  // Legacy fallback chip — shown only when `best_light_notes` is absent.
  bestTimeChipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md,
  },
  bestTimeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
  },
  bestTimeChipTxt: {
    color: colors.primary, fontFamily: font.bodyMedium,
    fontSize: 11, letterSpacing: 0.3, textTransform: 'capitalize',
  },
  ownerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: space.xl, padding: space.md,
    backgroundColor: colors.surface1, borderRadius: radii.md,
    borderColor: colors.border, borderWidth: 1,
  },
  ownerAvatar: { width: 40, height: 40, borderRadius: 20 },
  desc: { color: colors.textSecondary, fontFamily: font.body, fontSize: 15, lineHeight: 22, marginTop: space.lg },
  privacyNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.md,
    padding: space.md, backgroundColor: 'rgba(96,165,250,0.1)',
    borderColor: 'rgba(96,165,250,0.3)', borderWidth: 1, borderRadius: radii.md,
  },
  privacyNoteTxt: { color: colors.info, fontFamily: font.bodyMedium, fontSize: 12, flex: 1, lineHeight: 16 },
  directionsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: space.md, paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: colors.primary, borderRadius: radii.md,
  },
  directionsBtnTitle: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },
  directionsBtnSub: { color: 'rgba(255,255,255,0.82)', fontFamily: font.bodyMedium, fontSize: 11, marginTop: 2 },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: space.sm, paddingHorizontal: space.md, paddingVertical: 12,
    backgroundColor: colors.surface1, borderRadius: radii.md,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
  },
  aiIconBubble: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  aiBtnTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  aiBtnSub: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 2 },
  sectionH: { color: colors.text, fontFamily: font.display, fontSize: 20, marginTop: space.xl, letterSpacing: -0.2 },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.xl },
  sectionHsub: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },
  // Community CTAs (Feature 9) — primary photo upload + secondary text update.
  communityCtaRow: { flexDirection: 'row', gap: 8, marginTop: space.md, marginBottom: space.sm },
  communityCtaPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.primary },
  communityCtaPrimaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13 },
  communityCtaSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radii.md, backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)' },
  communityCtaSecondaryTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 },
  scoreGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: space.md,
    padding: space.lg, backgroundColor: colors.surface1, borderRadius: radii.lg,
    borderColor: colors.border, borderWidth: 1, justifyContent: 'space-between',
  },
  infoRow: { flexDirection: 'row', gap: 8, marginTop: space.md, flexWrap: 'wrap' },
  infoCard: {
    flex: 1, minWidth: '22%', backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, padding: space.md,
    borderRadius: radii.md, gap: 4, alignItems: 'flex-start',
  },
  infoLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  infoValue: { color: colors.text, fontFamily: font.bodyBold, fontSize: 15 },
  logRow: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    padding: space.md, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.md,
  },
  logIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  logLabel: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  logText: { color: colors.text, fontFamily: font.body, fontSize: 13, lineHeight: 18, marginTop: 2 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md },
  badge: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill,
    borderColor: 'rgba(16,185,129,0.4)', borderWidth: 1,
  },
  badgeText: { color: colors.success, fontFamily: font.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  reviewCard: {
    padding: space.md, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.md,
  },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8,
    paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xl,
    backgroundColor: 'rgba(10,10,10,0.95)',
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  actBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: radii.md,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  actBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary, flex: 1.4 },
  actTxt: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: space.md, borderRadius: radii.md,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: colors.primary, borderWidth: 1,
    marginBottom: space.md,
  },
  pendingDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary,
    marginLeft: 4,
  },
  pendingTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  pendingBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 2 },
  requestEditBtn: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 },
  requestEditTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 13 },
});

// Destructive-action palette — red/danger treatments for super-admin
// Delete Spot zone and photo-manager card. Kept separate so the
// "sad" colors can't accidentally bleed into the happy-path UI.
export const sadStyles = StyleSheet.create({
  dangerZone: {
    marginTop: space.xl,
    backgroundColor: 'rgba(255,64,90,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,64,90,0.35)',
    borderRadius: radii.lg,
    padding: space.md,
    gap: space.sm,
  },
  dangerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dangerTitle: { color: colors.secondary, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  dangerBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.secondary, paddingVertical: 12, borderRadius: radii.md,
    alignSelf: 'flex-start', paddingHorizontal: 14,
  },
  dangerBtnTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 13 },
  photoMgrCard: {
    marginTop: space.xl,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)',
    borderRadius: radii.lg,
    padding: space.md,
  },
  photoMgrIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoMgrTitle: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 14 },
  photoMgrSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
});
