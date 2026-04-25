/**
 * Network tab — top-level shell with Discover ↔ Directory toggle.
 *
 *   • Discover  → DiscoverPremiumView (Apr 2026 opportunity engine).
 *   • Directory → DirectoryView (paginated searchable photographer list).
 *
 * Body is intentionally light — both views own their own search bar,
 * filter pills, and ScrollView so the parent only manages the toggle.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Share, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Compass, BookOpen, MessageSquare, UserPlus } from 'lucide-react-native';
import { colors, font, space } from '../../src/theme';
import DirectoryView from '../../src/components/DirectoryView';
import DiscoverPremiumView from '../../src/components/DiscoverPremiumView';
import CommunityView from '../../src/components/CommunityView';

export default function NetworkTab() {
  const [view, setView] = useState<'discover' | 'directory' | 'community'>('discover');

  const onShareApp = async () => {
    try {
      await Share.share({
        message:
          'Join me on LumaScout — find amazing photo spots, connect with photographers 📸\n\nhttps://lumascout.app',
        url: 'https://lumascout.app',
        title: 'LumaScout',
      });
    } catch {}
  };

  const headerTitle =
    view === 'directory' ? 'Browse photographers'
    : view === 'community' ? 'Community'
    : 'Discover photographers';
  const headerSubtitle =
    view === 'directory' ? 'Browse creators near you and across specialties'
    : view === 'community' ? 'Connect with photographers — share, ask, refer.'
    : 'Find creators, collaborators, and opportunities near you.';

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>NETWORK</Text>
          <Text style={s.title}>{headerTitle}</Text>
          <Text style={s.subtitle}>{headerSubtitle}</Text>
        </View>
        <Pressable
          onPress={onShareApp}
          style={s.headerShareBtn}
          testID="network-share-app"
        >
          <UserPlus size={18} color={colors.primary} />
        </Pressable>
      </View>

      {/* Discover ↔ Directory ↔ Community segmented toggle (3 tabs) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.viewToggleRow}
      >
        <Pressable
          onPress={() => setView('discover')}
          style={[s.viewToggleBtn, view === 'discover' && s.viewToggleBtnActive]}
          testID="network-view-discover"
        >
          <Compass size={14} color={view === 'discover' ? colors.bg : colors.textSecondary} />
          <Text style={[s.viewToggleTxt, view === 'discover' && s.viewToggleTxtActive]}>
            Discover
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView('directory')}
          style={[s.viewToggleBtn, view === 'directory' && s.viewToggleBtnActive]}
          testID="network-view-directory"
        >
          <BookOpen size={14} color={view === 'directory' ? colors.bg : colors.textSecondary} />
          <Text style={[s.viewToggleTxt, view === 'directory' && s.viewToggleTxtActive]}>
            Directory
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView('community')}
          style={[s.viewToggleBtn, view === 'community' && s.viewToggleBtnActive]}
          testID="network-view-community"
        >
          <MessageSquare size={14} color={view === 'community' ? colors.bg : colors.textSecondary} />
          <Text style={[s.viewToggleTxt, view === 'community' && s.viewToggleTxtActive]}>
            Community
          </Text>
        </Pressable>
      </ScrollView>

      {view === 'directory' ? <DirectoryView />
        : view === 'community' ? <CommunityView />
        : <DiscoverPremiumView />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  headerShareBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
  },
  kicker: {
    color: colors.primary,
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  title: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 24,
    marginTop: 2,
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  viewToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: space.xl,
    paddingTop: 8,
    paddingBottom: 12,
  },
  viewToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewToggleBtnActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  viewToggleTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodySemibold,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  viewToggleTxtActive: {
    color: colors.bg,
    fontFamily: font.bodyBold,
  },
});
