import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, FolderPlus, Sparkles, CheckCircle2, Bookmark } from 'lucide-react-native';
import { api, formatApiError } from '../../../src/api';
import { colors, font, space, radii } from '../../../src/theme';

type PlanSpot = {
  spot_id: string; title: string; city?: string; state?: string;
  primary_photo?: string | null; shoot_score?: number;
  best_time_of_day?: string; reason?: string;
};
type CollectionPlan = {
  name: string; description: string; theme: string;
  spots: PlanSpot[]; count: number; disclosure?: string;
};

export default function CollectionPlanner() {
  const [theme, setTheme] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<CollectionPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const run = async () => {
    setErr('');
    if (!theme.trim()) { setErr('Describe the vibe or theme you want.'); return; }
    setLoading(true);
    setPlan(null);
    try {
      const res = await api.post('/ai/plan/collection', {
        theme: theme.trim(),
        city: city.trim() || undefined,
        min_count: 5, max_count: 10 });
      setPlan(res);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const saveCollection = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      const col = await api.post('/collections', {
        name: plan.name,
        description: plan.description,
        is_private: false });
      const col_id = col.collection_id || col.id;
      if (col_id) {
        for (const s of plan.spots) {
          try { await api.post(`/collections/${col_id}/spots`, { spot_id: s.spot_id }); } catch {}
        }
        Alert.alert('Saved', `"${plan.name}" added to your collections.`, [
          { text: 'View', onPress: () => router.replace(`/collection/${col_id}` as any) },
          { text: 'Done' },
        ]);
      }
    } catch (e) {
      Alert.alert('Could not save', formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headTitle}>Collection planner</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
          <View style={styles.iconBubble}><FolderPlus size={20} color="#74d88f" /></View>
          <Text style={styles.head}>What kind of collection?</Text>
          <Text style={styles.sub}>Describe a vibe, subject, or story. Scout AI will pick 5–10 matching public spots.</Text>

          <Text style={styles.label}>Theme</Text>
          <TextInput
            value={theme}
            onChangeText={setTheme}
            placeholder="e.g. coastal sunset portraits, urban architectural lines…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            multiline
            testID="cp-theme"
          />
          <Text style={styles.label}>Region (optional)</Text>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="City — leave empty for anywhere"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            testID="cp-city"
          />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <TouchableOpacity
            style={[styles.cta, loading && { opacity: 0.6 }]}
            disabled={loading}
            onPress={run}
            testID="cp-generate"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <>
              <Sparkles size={16} color="#fff" />
              <Text style={styles.ctaTxt}>Plan my collection</Text>
            </>}
          </TouchableOpacity>

          {plan && (
            <View style={{ marginTop: space.xxl }}>
              <Text style={styles.planTitle}>{plan.name}</Text>
              {!!plan.description && <Text style={styles.planBody}>{plan.description}</Text>}
              <Text style={styles.planMeta}>{plan.count} spots · theme: {plan.theme}</Text>

              {plan.spots.map((s, i) => (
                <TouchableOpacity
                  key={s.spot_id}
                  style={styles.spotCard}
                  onPress={() => router.push(`/spot/${s.spot_id}` as any)}
                >
                  <Text style={styles.spotIndex}>{String(i + 1).padStart(2, '0')}</Text>
                  {s.primary_photo ? (
                    <Image source={{ uri: s.primary_photo }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }]}>
                      <Bookmark size={18} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.spotTitle} numberOfLines={1}>{s.title}</Text>
                    {(s.city || s.state) && (
                      <Text style={styles.spotMeta} numberOfLines={1}>{[s.city, s.state].filter(Boolean).join(', ')}</Text>
                    )}
                    {!!s.reason && <Text style={styles.spotReason} numberOfLines={2}>{s.reason}</Text>}
                  </View>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                disabled={saving}
                onPress={saveCollection}
                testID="cp-save"
              >
                {saving ? <ActivityIndicator color="#fff" /> : <>
                  <CheckCircle2 size={16} color="#fff" />
                  <Text style={styles.ctaTxt}>Save as collection</Text>
                </>}
              </TouchableOpacity>
              {!!plan.disclosure && <Text style={styles.disclosure}>{plan.disclosure}</Text>}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 17 },
  iconBubble: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(116,216,143,0.14)', borderWidth: 1, borderColor: 'rgba(116,216,143,0.35)', marginBottom: space.md },
  head: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13.5, lineHeight: 20, marginTop: 6 },
  label: { color: colors.textSecondary, fontFamily: font.bodySemibold, fontSize: 11, marginTop: space.lg, marginBottom: 6 },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 14, minHeight: 48, textAlignVertical: 'top' },
  err: { color: colors.secondary, fontFamily: font.body, fontSize: 12, marginTop: 8 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.md, marginTop: space.lg },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#74d88f', paddingVertical: 14, borderRadius: radii.md, marginTop: space.lg },
  ctaTxt: { color: '#fff', fontFamily: font.bodyBold, fontSize: 14 },
  planTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.4 },
  planBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13.5, lineHeight: 20, marginTop: 4 },
  planMeta: { color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 11, marginTop: 6, marginBottom: space.md },
  spotCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 10, marginBottom: 8 },
  spotIndex: { color: colors.textTertiary, fontFamily: font.bodyBold, fontSize: 11, width: 20 },
  thumb: { width: 54, height: 54, borderRadius: radii.sm, backgroundColor: colors.surface2 },
  spotTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  spotMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 1 },
  spotReason: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  disclosure: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11, marginTop: 10, textAlign: 'center' } });
