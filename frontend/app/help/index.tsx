/**
 * Help Center — searchable in-app FAQ + support directory.
 *
 * Premium dark luxury layout. 7 categories, 30+ Q&A entries, native search
 * with instant filtering, and a contact-support footer.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  User,
  CreditCard,
  Upload,
  MessageCircle,
  ShoppingBag,
  Shield,
  LifeBuoy,
} from 'lucide-react-native';
import { colors, font, space, radii } from '../../src/theme';

type FaqEntry = { q: string; a: string };
type Category = {
  key: string;
  title: string;
  subtitle: string;
  icon: any;
  entries: FaqEntry[];
};

const CATEGORIES: Category[] = [
  {
    key: 'account',
    title: 'Account',
    subtitle: 'Profile, login, and password',
    icon: User,
    entries: [
      {
        q: 'How do I change my email or password?',
        a: 'Open Settings → Account → Email or Password. Email changes require a confirmation link sent to the new address.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Settings → Account → Delete account. This is permanent and removes all your spots, packs, posts, and DMs within 7 days.',
      },
      {
        q: 'I forgot my password.',
        a: 'On the login screen, tap "Forgot password" and enter your email. We send a one-time reset link valid for 30 minutes.',
      },
      {
        q: 'Can I change my username?',
        a: 'Yes — Settings → Edit Profile → Username. You can change it once every 30 days.',
      },
      {
        q: 'How do I enable two-factor authentication?',
        a: '2FA is rolling out in 2026. For now, use a unique strong password and your device biometric to keep the app secure.',
      },
    ],
  },
  {
    key: 'membership',
    title: 'Membership',
    subtitle: 'Free, Pro, Elite, and complimentary plans',
    icon: CreditCard,
    entries: [
      {
        q: 'What does Pro give me vs. Free?',
        a: 'Unlimited saves, advanced filters, weather/golden-hour overlays, premium-spot access, and creator tools (Pro Profile + analytics).',
      },
      {
        q: 'What does Elite give me vs. Pro?',
        a: 'Everything in Pro plus priority directory placement, featured creator badge, route planning, marketplace fee discount (10% vs 15%), and early access to new features.',
      },
      {
        q: 'How do I cancel my subscription?',
        a: 'Settings → Account → Subscription → Manage. Cancellation takes effect at the end of your current billing period; you keep paid access until then.',
      },
      {
        q: 'I see "ELITE • COMP" on my profile — what does that mean?',
        a: 'Complimentary access granted by LumaScout staff. You have all Elite features without being billed. Some accounts (admins, beta members, partners) qualify for COMP plans.',
      },
      {
        q: 'I just upgraded but the app still shows "Upgrade to Pro".',
        a: 'Pull-to-refresh, or background and re-open the app. Plan changes propagate within seconds. If it persists for more than 5 minutes, contact support@lumascout.app.',
      },
      {
        q: 'Can I switch between monthly and annual?',
        a: 'Yes. Settings → Subscription → Change plan. The switch takes effect at your next renewal so you don\'t lose any paid time.',
      },
    ],
  },
  {
    key: 'uploading',
    title: 'Uploading Spots',
    subtitle: 'Photos, location data, and reviews',
    icon: Upload,
    entries: [
      {
        q: 'Why was my spot rejected?',
        a: 'Common reasons: low-quality photo, blurry/dark, missing or imprecise GPS, or the location is on private land without permission. The decline reason is shown in your inbox.',
      },
      {
        q: 'How specific should the GPS coordinates be?',
        a: 'Use your phone\'s "drop a pin" feature on the actual shooting spot. We offer Exact (pin-perfect) or Approximate (~1km) display options to protect sensitive places.',
      },
      {
        q: 'Can I edit a spot after submitting?',
        a: 'Yes — open the spot, tap the menu (⋯), and select Edit. Changes go through a quick re-review.',
      },
      {
        q: 'What\'s "Land Access"?',
        a: 'Whether the spot is on public or private land, and what permission is required (free, permit, paid entry, etc.). This protects landowners and helps fellow photographers prepare.',
      },
      {
        q: 'How are duplicate spots handled?',
        a: 'If a spot is uploaded within 200m of an existing approved one, we merge the listings. Your photos are credited to your profile.',
      },
    ],
  },
  {
    key: 'messaging',
    title: 'Messaging',
    subtitle: 'DMs, blocking, and notifications',
    icon: MessageCircle,
    entries: [
      {
        q: 'Why can\'t I message a creator?',
        a: 'Some creators only allow DMs from people they follow back. Pro and Elite users have priority outreach to verified creators.',
      },
      {
        q: 'How do I block someone?',
        a: 'Open their profile → Menu (⋯) → Block. Blocked users can\'t message you, view your profile, or see your spots.',
      },
      {
        q: 'How do I report a message?',
        a: 'Long-press the message → Report. We review reports within 48 hours and take action on Community Guidelines violations.',
      },
      {
        q: 'Are read receipts shared?',
        a: 'Yes, by default. You can disable read receipts in Settings → Notifications → Privacy.',
      },
    ],
  },
  {
    key: 'marketplace',
    title: 'Marketplace',
    subtitle: 'Buying and selling packs',
    icon: ShoppingBag,
    entries: [
      {
        q: 'How do I buy a pack?',
        a: 'Tap any pack to open it, then tap Buy Now. Payment is processed by Stripe; downloads are available immediately in your inbox.',
      },
      {
        q: 'I bought a pack but can\'t find the download.',
        a: 'Open Inbox → Orders. Each completed purchase has a Download Files button. Files stay available for unlimited re-downloads.',
      },
      {
        q: 'How do I become a seller?',
        a: 'Settings → Marketplace → Become a Seller. You\'ll connect a Stripe Connect account for payouts and accept the Marketplace Seller Terms.',
      },
      {
        q: 'When do I get paid for sales?',
        a: 'Weekly on Mondays via Stripe. New sellers have a 7-day initial hold; ongoing sales arrive on a 7-day rolling basis.',
      },
      {
        q: 'Can I get a refund?',
        a: 'See our full Refund Policy. Digital goods are non-refundable once downloaded, except for materially defective products reported within 14 days.',
      },
    ],
  },
  {
    key: 'safety',
    title: 'Safety & Privacy',
    subtitle: 'Reporting, blocking, and your data',
    icon: Shield,
    entries: [
      {
        q: 'How do I report a user, post, or spot?',
        a: 'Tap the menu (⋯) on any post, profile, or spot and select Report. We review every report within 48 hours.',
      },
      {
        q: 'Will other users see my exact location?',
        a: 'Never your live location. Your saved profile city is public; spot coordinates can be set to Exact or Approximate (~1km) per spot.',
      },
      {
        q: 'How is my photo data protected?',
        a: 'EXIF stripped of GPS by default unless you opt in. Photos are stored encrypted at rest and served over HTTPS only.',
      },
      {
        q: 'Can I export my data?',
        a: 'Yes — email support@lumascout.app and we\'ll send a JSON archive of your profile, spots, posts, and saved collections within 7 days.',
      },
    ],
  },
  {
    key: 'support',
    title: 'Contact Support',
    subtitle: 'Real humans, fast replies',
    icon: LifeBuoy,
    entries: [
      {
        q: 'How do I reach support?',
        a: 'Email support@lumascout.app. We respond within one business day, often much faster.',
      },
      {
        q: 'Is there phone or chat support?',
        a: 'Not yet. We\'re a small team and email lets us answer thoughtfully without keeping you on hold. Live chat is on the 2026 roadmap.',
      },
      {
        q: 'Hours of operation?',
        a: 'We monitor support 7 days a week, 9am–8pm CT. Urgent safety reports are answered around the clock.',
      },
      {
        q: 'I have feedback or a feature request.',
        a: 'We love it! Email feedback@lumascout.app or use the in-app "Feedback" item in Settings → About. Every email is read by a real person.',
      },
    ],
  },
];

const ALL_ENTRIES_FLAT = CATEGORIES.flatMap((c) =>
  c.entries.map((e) => ({ ...e, category: c.title, categoryKey: c.key })),
);

export default function HelpCenter() {
  const [query, setQuery] = useState('');
  const [openCat, setOpenCat] = useState<string | null>(null);

  const trimmed = query.trim().toLowerCase();
  const isSearching = trimmed.length > 1;

  const matches = useMemo(() => {
    if (!isSearching) return [] as typeof ALL_ENTRIES_FLAT;
    return ALL_ENTRIES_FLAT.filter(
      (e) =>
        e.q.toLowerCase().includes(trimmed) ||
        e.a.toLowerCase().includes(trimmed) ||
        e.category.toLowerCase().includes(trimmed),
    ).slice(0, 30);
  }, [trimmed, isSearching]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.head}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Help Center</Text>
          <Text style={s.subtitle}>Search articles or browse by category</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={s.searchWrap}>
          <Search size={16} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search help articles…"
            placeholderTextColor={colors.textTertiary}
            style={s.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            testID="help-search-input"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <X size={16} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {isSearching ? (
            <View>
              <Text style={s.searchHint}>
                {matches.length} result{matches.length === 1 ? '' : 's'} for "{query.trim()}"
              </Text>
              {matches.length === 0 ? (
                <View style={s.noResult}>
                  <Text style={s.noResultTitle}>No matches found</Text>
                  <Text style={s.noResultBody}>
                    Try a different keyword or email{' '}
                    <Text
                      style={s.link}
                      onPress={() => Linking.openURL('mailto:support@lumascout.app')}
                    >
                      support@lumascout.app
                    </Text>
                    .
                  </Text>
                </View>
              ) : (
                matches.map((m, i) => (
                  <View key={`m-${i}`} style={s.entry}>
                    <Text style={s.entryCategory}>{m.category.toUpperCase()}</Text>
                    <Text style={s.entryQ}>{m.q}</Text>
                    <Text style={s.entryA}>{m.a}</Text>
                  </View>
                ))
              )}
            </View>
          ) : (
            <View>
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                const isOpen = openCat === c.key;
                return (
                  <View key={c.key} style={s.catWrap}>
                    <Pressable
                      onPress={() => setOpenCat((k) => (k === c.key ? null : c.key))}
                      style={s.catRow}
                      testID={`help-cat-${c.key}`}
                    >
                      <View style={s.catIconWrap}>
                        <Icon size={18} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.catTitle}>{c.title}</Text>
                        <Text style={s.catSubtitle}>{c.subtitle}</Text>
                      </View>
                      <View
                        style={[
                          s.catChev,
                          isOpen && { transform: [{ rotate: '90deg' }] },
                        ]}
                      >
                        <ChevronRight size={16} color={colors.textTertiary} />
                      </View>
                    </Pressable>
                    {isOpen ? (
                      <View style={s.entriesList}>
                        {c.entries.map((e, i) => (
                          <View key={`${c.key}-${i}`} style={s.entryNested}>
                            <Text style={s.entryQ}>{e.q}</Text>
                            <Text style={s.entryA}>{e.a}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {/* Contact-support footer */}
              <Pressable
                onPress={() => Linking.openURL('mailto:support@lumascout.app')}
                style={s.contactBtn}
                testID="help-contact-support"
              >
                <View style={s.contactIcon}>
                  <LifeBuoy size={16} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.contactTitle}>Still need help?</Text>
                  <Text style={s.contactBody}>
                    Email support@lumascout.app — we reply within one business day.
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface1,
  },
  title: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 1 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: font.body,
    fontSize: 15,
    padding: 0,
  },
  searchHint: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: space.md,
  },

  scroll: {
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
  },

  catWrap: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    marginBottom: space.md,
    overflow: 'hidden',
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
  },
  catIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  catTitle: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 15,
    letterSpacing: -0.1,
  },
  catSubtitle: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12.5,
    marginTop: 2,
    lineHeight: 17,
  },
  catChev: { marginLeft: 'auto' },

  entriesList: {
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    gap: space.md,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
  },
  entryNested: {
    paddingVertical: 4,
  },
  entry: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  entryCategory: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 6,
  },
  entryQ: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 14.5,
    lineHeight: 20,
    marginBottom: 6,
  },
  entryA: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 13.5,
    lineHeight: 20,
  },

  noResult: {
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.xl,
    alignItems: 'center',
  },
  noResultTitle: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 15,
    marginBottom: 6,
  },
  noResultBody: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  link: { color: colors.primary, fontFamily: font.bodySemibold },

  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.30)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: space.lg,
    marginTop: space.sm,
  },
  contactIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14.5 },
  contactBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12.5, marginTop: 2 },
});
