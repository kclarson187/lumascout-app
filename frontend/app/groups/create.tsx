import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';

const SPECS = ['Family', 'Wedding', 'Pet', 'Nature', 'Urban', 'Portrait', 'Travel', 'Lifestyle', 'Kids', 'Commercial'];

export default function CreateGroup() {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState(user?.city || '');
  const [state, setState] = useState(user?.state || '');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (s: string) => {
    setSpecialties((x) => x.includes(s) ? x.filter((y) => y !== s) : [...x, s]);
  };

  const submit = async () => {
    if (name.trim().length < 3) { Alert.alert('Name too short', 'At least 3 characters.'); return; }
    setBusy(true);
    try {
      const g = await api.post('/groups', {
        name: name.trim(), tagline: tagline.trim(), description: description.trim(),
        city: city.trim() || null, state: state.trim() || null, specialties });
      router.replace(`/groups/${g.group_id}`);
    } catch (e) { Alert.alert('Could not create group', formatApiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
          <Text style={styles.title}>New group</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}>
          <Text style={styles.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="e.g. Austin Family Photographers" placeholderTextColor={colors.textTertiary} style={styles.input} maxLength={80} testID="gc-name" />

          <Text style={styles.label}>Tagline</Text>
          <TextInput value={tagline} onChangeText={setTagline} placeholder="One line that describes the group" placeholderTextColor={colors.textTertiary} style={styles.input} maxLength={140} testID="gc-tagline" />

          <Text style={styles.label}>Description</Text>
          <TextInput value={description} onChangeText={setDescription} placeholder="What the group is about, what members share, meetups…" placeholderTextColor={colors.textTertiary} multiline style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} maxLength={2000} testID="gc-desc" />

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>City</Text>
              <TextInput value={city} onChangeText={setCity} placeholder="Austin" placeholderTextColor={colors.textTertiary} style={styles.input} testID="gc-city" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>State</Text>
              <TextInput value={state} onChangeText={setState} placeholder="TX" placeholderTextColor={colors.textTertiary} style={styles.input} maxLength={3} autoCapitalize="characters" testID="gc-state" />
            </View>
          </View>

          <Text style={styles.label}>Specialties</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {SPECS.map((s) => {
              const on = specialties.includes(s);
              return (
                <TouchableOpacity key={s} onPress={() => toggle(s)} style={[styles.chip, on && styles.chipActive]}>
                  <Text style={[styles.chipTxt, on && styles.chipTxtActive]}>{s}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Button title="Create group" onPress={submit} loading={busy} testID="gc-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24, letterSpacing: -0.3 },
  label: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11 },
  input: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: space.md, paddingVertical: 12, color: colors.text, fontFamily: font.body, fontSize: 15 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  chipTxtActive: { color: colors.textInverse } });
