/**
 * Admin — Scout AI controls (PRD Scout AI Phase 3).
 *
 * Lets moderators/super-admins:
 *   • Toggle Scout AI globally + for community replies + for editorial posts
 *   • Set daily post cap and unanswered-question delay
 *   • Instantly generate an editorial post (optional city focus)
 *   • Paste a post_id to draft a Scout AI reply comment on it
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch,
  ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Sparkles, Send, Megaphone } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import ScoutAIAvatar from '../../src/components/ScoutAIAvatar';

type Settings = {
  enabled: boolean;
  community_replies_enabled: boolean;
  editorial_posts_enabled: boolean;
  max_posts_per_day: number;
  unanswered_reply_delay_hours: number;
  posts_today?: number;
  updated_at?: string;
};

export default function AdminAiControls() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editCity, setEditCity] = useState('');
  const [replyPostId, setReplyPostId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setSettings(await api.get('/admin/ai/settings')); }
    catch (e) { Alert.alert('Error', formatApiError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = async (partial: Partial<Settings>) => {
    if (!settings) return;
    const optimistic = { ...settings, ...partial } as Settings;
    setSettings(optimistic);
    setSaving(true);
    try { setSettings(await api.post('/admin/ai/settings', partial)); }
    catch (e) { Alert.alert('Error', formatApiError(e)); setSettings(settings); }
    finally { setSaving(false); }
  };

  const generateEditorial = async () => {
    setBusy(true);
    try {
      const r = await api.post('/admin/ai/generate-editorial', {}, { params: editCity ? { city: editCity } : undefined });
      Alert.alert('Editorial posted', `"${r.title}" published to the community feed by Scout AI.`);
      setEditCity('');
      await load();
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
    finally { setBusy(false); }
  };

  const replyToPost = async () => {
    const id = replyPostId.trim();
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/admin/ai/reply-to-post/${id}`, {});
      Alert.alert('Reply posted', 'Scout AI reply added to the post.');
      setReplyPostId('');
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
    finally { setBusy(false); }
  };

  if (loading || !settings) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </TouchableOpacity>
          <ScoutAIAvatar size={32} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Scout AI controls</Text>
            <Text style={styles.subtitle}>Posts today: {settings.posts_today ?? 0} / {settings.max_posts_per_day}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 60, gap: space.lg }}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>CADENCE</Text>
            <ToggleRow label="Scout AI enabled" value={settings.enabled} onChange={(v) => patch({ enabled: v })} />
            <ToggleRow label="Can reply in community" value={settings.community_replies_enabled} onChange={(v) => patch({ community_replies_enabled: v })} />
            <ToggleRow label="Can post editorial cards" value={settings.editorial_posts_enabled} onChange={(v) => patch({ editorial_posts_enabled: v })} />
            <StepperRow
              label="Max posts per day"
              value={settings.max_posts_per_day}
              min={0} max={20}
              onChange={(v) => patch({ max_posts_per_day: v })}
            />
            <StepperRow
              label="Unanswered-Q reply delay (hours)"
              value={settings.unanswered_reply_delay_hours}
              min={1} max={168}
              onChange={(v) => patch({ unanswered_reply_delay_hours: v })}
            />
            {saving && <Text style={styles.savingTxt}>Saving…</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>EDITORIAL POST</Text>
            <Text style={styles.help}>
              Compose and publish one of Scout AI's editorial cards (rotates daily). Optional city focus.
            </Text>
            <TextInput
              placeholder="Optional city (e.g. Austin)"
              placeholderTextColor={colors.textTertiary}
              value={editCity}
              onChangeText={setEditCity}
              style={styles.input}
              testID="ai-city-input"
            />
            <TouchableOpacity
              onPress={generateEditorial}
              disabled={busy}
              style={[styles.primaryBtn, busy && { opacity: 0.5 }]}
              testID="ai-generate-editorial"
            >
              <Megaphone size={14} color={colors.textInverse} />
              <Text style={styles.primaryTxt}>{busy ? 'Publishing…' : 'Generate & publish'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>REPLY TO A POST</Text>
            <Text style={styles.help}>
              Paste the post_id of a community post (it's shown in the /admin/posts list) and Scout AI will draft a helpful reply comment.
            </Text>
            <TextInput
              placeholder="pst_xxxxxxxxxxxx"
              placeholderTextColor={colors.textTertiary}
              value={replyPostId}
              onChangeText={setReplyPostId}
              style={styles.input}
              autoCapitalize="none"
              testID="ai-reply-input"
            />
            <TouchableOpacity
              onPress={replyToPost}
              disabled={busy || !replyPostId.trim()}
              style={[styles.primaryBtn, (busy || !replyPostId.trim()) && { opacity: 0.5 }]}
              testID="ai-reply-submit"
            >
              <Send size={14} color={colors.textInverse} />
              <Text style={styles.primaryTxt}>{busy ? 'Sending…' : 'Draft Scout AI reply'}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.card, { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.05)' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Sparkles size={12} color={colors.primary} />
              <Text style={[styles.cardLabel, { color: colors.primary }]}>TRUST</Text>
            </View>
            <Text style={styles.help}>
              All Scout AI posts and replies are clearly labeled as Official AI in the community feed.
              Decisions here are written to the admin audit log.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.textInverse} />
    </View>
  );
}

function StepperRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity onPress={() => onChange(Math.max(min, value - 1))} style={styles.stepBtn}>
          <Text style={styles.stepBtnTxt}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepVal}>{value}</Text>
        <TouchableOpacity onPress={() => onChange(Math.min(max, value + 1))} style={styles.stepBtn}>
          <Text style={styles.stepBtnTxt}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: space.xl, paddingVertical: space.md,
    borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 20, letterSpacing: -0.3 },
  subtitle: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11 },
  card: { backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: space.lg, gap: 10 },
  cardLabel: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: colors.text, fontFamily: font.body, fontSize: 13, flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt: { color: colors.text, fontFamily: font.bodyBold, fontSize: 18, lineHeight: 18 },
  stepVal: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, minWidth: 24, textAlign: 'center' },
  help: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  input: {
    color: colors.text, fontFamily: font.body, fontSize: 13,
    backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 10,
  },
  primaryBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radii.md,
  },
  primaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.2 },
  savingTxt: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, textAlign: 'right' },
});
