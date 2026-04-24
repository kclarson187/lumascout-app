/**
 * HomeInboxPreview — compact horizontal rail showing the viewer's 3 most
 * recent DM threads directly under the home-screen Scout AI card. Taps
 * deep-link into /inbox/[id]; the "See all" pill jumps to the full inbox.
 *
 * Designed to be *premium and compact*: fixed-height pill cards, avatar +
 * name + one-line preview + inline unread dot. Payload comes from the new
 * lightweight GET /api/dm/inbox/preview endpoint.
 *
 * Tier 1 Messaging Upgrade (2026-04).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { MessageCircle, ChevronRight, ShieldCheck } from 'lucide-react-native';
import { api } from '../api';
import { useAuth } from '../auth';
import { colors, font, radii, space } from '../theme';
import { timeAgo } from './FreshnessBits';
import EliteBadge from './EliteBadge';

type PreviewItem = {
  thread_id: string;
  other?: {
    user_id?: string;
    name?: string;
    username?: string;
    avatar_url?: string;
    verification_status?: string;
    plan?: string;
  } | null;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
};

export default function HomeInboxPreview({ limit = 3 }: { limit?: number }) {
  const { user } = useAuth();
  const [items, setItems] = useState<PreviewItem[] | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.get('/dm/inbox/preview', { limit });
      setItems(r.items || []);
    } catch {
      setItems([]);
    }
  }, [user, limit]);

  useEffect(() => {
    // Defer the first fetch a tick so the home shell paints first.
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load]);

  // Hide the module entirely until we know there's something to show —
  // prevents a blank header on the first home render for new users.
  if (!items || items.length === 0) return null;

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <View style={s.headLeft}>
          <MessageCircle size={14} color={colors.primary} />
          <Text style={s.title}>Recent messages</Text>
        </View>
        <Pressable
          style={s.seeAll}
          onPress={() => router.push('/inbox')}
          testID="home-inbox-preview-see-all"
        >
          <Text style={s.seeAllTxt}>See all</Text>
          <ChevronRight size={12} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.rail}
      >
        {items.map((it) => {
          const o = it.other || {};
          const unread = (it.unread_count || 0) > 0;
          return (
            <Pressable
              key={it.thread_id}
              style={[s.card, unread && s.cardUnread]}
              onPress={() => router.push(`/inbox/${it.thread_id}` as any)}
              testID={`home-inbox-preview-${it.thread_id}`}
            >
              <View style={s.avatarWrap}>
                {o.avatar_url ? (
                  <Image source={{ uri: o.avatar_url }} style={s.avatar} />
                ) : (
                  <View style={[s.avatar, s.avatarPh]}>
                    <Text style={s.avatarPhTxt}>
                      {(o.name || o.username || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                {unread ? <View style={s.unreadDot} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.nameRow}>
                  <Text
                    style={[s.name, unread && { fontFamily: font.bodyBold }]}
                    numberOfLines={1}
                  >
                    {o.name || `@${o.username || 'user'}`}
                  </Text>
                  {o.verification_status === 'verified' ? (
                    <ShieldCheck size={10} color="#3b82f6" />
                  ) : null}
                  {o.plan === 'elite' ? <EliteBadge variant="compact" /> : null}
                </View>
                <Text
                  style={[s.preview, unread && { color: colors.text }]}
                  numberOfLines={1}
                >
                  {it.last_message_preview || 'Say hi 👋'}
                </Text>
                <Text style={s.when}>
                  {it.last_message_at ? timeAgo(it.last_message_at) : ''}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: space.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    marginBottom: 6,
  },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  seeAllTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodyMedium,
    fontSize: 12,
  },
  rail: {
    paddingHorizontal: space.xl,
    gap: 8,
  },
  card: {
    width: 230,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardUnread: {
    borderColor: 'rgba(245,166,35,0.55)',
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarPh: {
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarPhTxt: {
    color: colors.textSecondary,
    fontFamily: font.bodyBold,
    fontSize: 13,
  },
  unreadDot: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: colors.surface1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  name: {
    color: colors.text,
    fontFamily: font.bodySemibold,
    fontSize: 13,
    flexShrink: 1,
  },
  preview: {
    color: colors.textSecondary,
    fontFamily: font.body,
    fontSize: 11,
    marginTop: 1,
  },
  when: {
    color: colors.textTertiary,
    fontFamily: font.body,
    fontSize: 9,
    marginTop: 2,
  },
});
