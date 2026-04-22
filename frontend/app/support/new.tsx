import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Send } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';

const CATEGORIES = [
  { k: 'general', label: 'General' },
  { k: 'bug', label: 'Bug' },
  { k: 'billing', label: 'Billing' },
  { k: 'abuse', label: 'Abuse / Safety' },
  { k: 'feature', label: 'Feature request' },
];

export default function NewTicket() {
  const [category, setCategory] = useState('general');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!subject.trim() || !body.trim()) {
      Alert.alert('Incomplete', 'Please enter a subject and a message.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/support/tickets', { category, subject: subject.trim(), body: body.trim() });
      Alert.alert("We've got it", "Your ticket is in the queue. We'll email you when a team member replies.", [
        { text: 'OK', onPress: () => router.replace('/support/mine') },
      ]);
    } catch (e) {
      Alert.alert('Could not send', formatApiError(e));
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="ticket-back">
            <ChevronLeft size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Contact support</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}>
          <Text style={styles.label}>Category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.k}
                onPress={() => setCategory(c.k)}
                style={[styles.chip, category === c.k && styles.chipActive]}
                testID={`ticket-cat-${c.k}`}
              >
                <Text style={[styles.chipTxt, category === c.k && styles.chipTxtActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Subject</Text>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="One-line summary…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            maxLength={140}
            testID="ticket-subject"
          />

          <Text style={styles.label}>Message</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Details: what happened, when, any steps to reproduce, screenshots you can describe…"
            placeholderTextColor={colors.textTertiary}
            multiline
            style={[styles.input, { minHeight: 160, textAlignVertical: 'top' }]}
            maxLength={4000}
            testID="ticket-body"
          />

          <Button title="Send" onPress={submit} loading={busy} testID="ticket-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24, letterSpacing: -0.3 },
  label: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 12 },
  chipTxtActive: { color: colors.textInverse },
});
