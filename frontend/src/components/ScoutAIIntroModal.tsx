/**
 * ScoutAIIntroModal — first-run welcome dialog for Scout AI.
 * Spec FLOW 1. Shown once to signed-in users; dismissal is persisted so the
 * modal never pops up twice for the same account (web-safe localStorage /
 * native SecureStore mirror).
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Check, X } from 'lucide-react-native';
import ScoutAIAvatar from './ScoutAIAvatar';
import { colors, font, space, radii } from '../theme';
import { useAuth } from '../auth';

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
  }
  try { return await SecureStore.getItemAsync(key); } catch { return null; }
}
async function storageSet(key: string, value: string) {
  if (Platform.OS === 'web') {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value); } catch { /* noop */ }
    return;
  }
  try { await SecureStore.setItemAsync(key, value); } catch { /* noop */ }
}

const BULLETS = [
  'Find places that match your shoot style',
  "Compare saved spots for tonight's light",
  'Get help uploading better locations',
  'Learn what Pro and Elite actually unlock',
];

export default function ScoutAIIntroModal() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const key = user ? `scout_ai_intro_seen_${user.user_id}` : '';

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const seen = await storageGet(key);
      if (!seen && !cancelled) setVisible(true);
    })();
    return () => { cancelled = true; };
  }, [user, key]);

  const close = async (goSetup: boolean) => {
    setVisible(false);
    try { await storageSet(key, String(Date.now())); } catch { /* noop */ }
    if (goSetup) router.push('/scout-ai/setup' as any);
  };

  if (!user) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => close(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity onPress={() => close(false)} style={styles.closeBtn} hitSlop={10}>
            <X size={18} color={colors.textTertiary} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <ScoutAIAvatar size={64} />
            <Text style={styles.title}>Meet Scout AI</Text>
            <Text style={styles.body}>
              Your official PhotoScout assistant for finding spots, planning shoots, understanding scores, and getting more out of the app.
            </Text>
          </View>
          <View style={{ gap: 8, marginTop: 18 }}>
            {BULLETS.map((b) => (
              <View key={b} style={styles.bulletRow}>
                <Check size={14} color={colors.success} />
                <Text style={styles.bulletTxt}>{b}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => close(true)} testID="scout-intro-try">
            <Text style={styles.primaryTxt}>Try Scout AI</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => close(false)} testID="scout-intro-later">
            <Text style={styles.secondaryTxt}>Maybe later</Text>
          </TouchableOpacity>
          <Text style={styles.disclosure}>
            Scout AI is an official PhotoScout assistant. Responses are AI-generated and based on available app data.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: space.xl },
  card: {
    backgroundColor: colors.surface1, borderColor: colors.primary, borderWidth: 1,
    borderRadius: radii.xl, padding: space.xl, gap: 8,
  },
  closeBtn: { position: 'absolute', top: 10, right: 10, padding: 6, zIndex: 2 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 26, letterSpacing: -0.4, textAlign: 'center' },
  body: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 320 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulletTxt: { color: colors.text, fontFamily: font.body, fontSize: 13, flex: 1 },
  primaryBtn: {
    marginTop: 20, backgroundColor: colors.primary, paddingVertical: 14,
    borderRadius: radii.md, alignItems: 'center',
  },
  primaryTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14, letterSpacing: 0.3 },
  secondaryBtn: { paddingVertical: 10, alignItems: 'center' },
  secondaryTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },
  disclosure: { color: colors.textTertiary, fontFamily: font.body, fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 4 },
});
