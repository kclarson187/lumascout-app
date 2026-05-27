import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input, Chip } from '../../src/components/ui';

export default function ReviewScreen() {
  const params = useLocalSearchParams<{ spotId: string }>();
  const spotId = String(params.spotId);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [checkinNote, setCheckinNote] = useState('');
  const [accessIssue, setAccessIssue] = useState(false);
  const [crowd, setCrowd] = useState(3);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      // Post both a review and check-in to keep it simple
      await api.post(`/spots/${spotId}/reviews`, { overall_rating: rating, comment });
      await api.post(`/spots/${spotId}/checkins`, {
        status_summary: accessIssue ? 'Access issue' : 'Still great',
        crowd_level: crowd,
        access_issue: accessIssue,
        notes: checkinNote });
      Alert.alert('Posted', 'Thanks for the update — this keeps spots fresh.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="review-back">
            <ChevronLeft size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Field check-in</Text>
        </View>

        <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 100 }}>
          <Text style={styles.label}>Overall rating</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity
                key={v}
                testID={`review-rate-${v}`}
                style={[styles.ratingDot, rating >= v && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                onPress={() => setRating(v)}
              >
                <Text style={{ color: rating >= v ? colors.textInverse : colors.textSecondary, fontFamily: font.bodyBold }}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input
            label="Comment"
            value={comment}
            onChangeText={setComment}
            multiline
            placeholder="How was the light? Any changes we should know?"
            style={{ minHeight: 100, textAlignVertical: 'top' }}
            testID="review-comment"
          />

          <Text style={styles.label}>Quick field update</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Still looks great" active={!accessIssue} onPress={() => setAccessIssue(false)} />
            <Chip label="Access issue" active={accessIssue} onPress={() => setAccessIssue(true)} />
          </View>

          <Text style={styles.label}>Crowd level (5 = very crowded)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity key={v} style={[styles.ratingDot, crowd === v && { backgroundColor: colors.info, borderColor: colors.info }]} onPress={() => setCrowd(v)}>
                <Text style={{ color: crowd === v ? colors.textInverse : colors.textSecondary, fontFamily: font.bodyBold }}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input
            label="Notes (optional)"
            value={checkinNote}
            onChangeText={setCheckinNote}
            multiline
            placeholder="Flowers blooming? Construction? Permit change?"
            style={{ minHeight: 80, textAlignVertical: 'top' }}
          />

          <Button title="Post update" onPress={submit} loading={loading} testID="review-submit" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 24 },
  label: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11 },
  ratingDot: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center' } });
