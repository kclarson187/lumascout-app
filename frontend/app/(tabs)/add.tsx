import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Switch,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { ChevronLeft, ChevronRight, MapPin, Image as ImageIcon, Plus, Check, X, Zap } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii, SHOOT_TYPES, BEST_TIMES, PRIVACY_MODES } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { Input, Chip } from '../../src/components/ui';

const STEPS = ['Location', 'Photos', 'Details', 'Notes', 'Privacy', 'Review'];

type Draft = {
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  images: { image_url: string; caption?: string; is_cover: boolean }[];
  title: string;
  city: string;
  state: string;
  description: string;
  shoot_types: string[];
  style_tags: string[];
  best_time_of_day?: string;
  sunrise_rating: number;
  sunset_rating: number;
  morning_golden_hour_rating: number;
  evening_golden_hour_rating: number;
  shade_rating: number;
  variety_rating: number;
  crowd_level: number;
  safety_rating: number;
  dog_friendly: boolean;
  kid_friendly: boolean;
  accessible: boolean;
  indoor: boolean;
  permit_required: boolean;
  fee_required: boolean;
  parking_notes: string;
  lens_recommendations: string;
  privacy_mode: string;
  location_display_mode: string;
};

const initialDraft: Draft = {
  images: [],
  title: '',
  city: '',
  state: 'TX',
  description: '',
  shoot_types: [],
  style_tags: [],
  sunrise_rating: 3,
  sunset_rating: 4,
  morning_golden_hour_rating: 4,
  evening_golden_hour_rating: 4,
  shade_rating: 3,
  variety_rating: 4,
  crowd_level: 3,
  safety_rating: 4,
  dog_friendly: false,
  kid_friendly: true,
  accessible: false,
  indoor: false,
  permit_required: false,
  fee_required: false,
  parking_notes: '',
  lens_recommendations: '',
  privacy_mode: 'public',
  location_display_mode: 'exact',
};

export default function AddSpot() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: space.xl }}>
        <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 28, marginBottom: 12 }}>
          Sign in to add spots
        </Text>
        <Button title="Sign in" onPress={() => router.push('/(auth)/login')} />
      </SafeAreaView>
    );
  }

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const prev = () => (step === 0 ? router.replace('/(tabs)') : setStep((s) => s - 1));

  const useMyLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location permission denied');
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    setDraft({ ...draft, latitude: loc.coords.latitude, longitude: loc.coords.longitude, locationLabel: `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}` });
  };

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Media permission required to upload photos');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.6,
      base64: true,
      selectionLimit: 6,
    });
    if (res.canceled) return;
    const added = res.assets.map((a, i) => ({
      image_url: a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri,
      is_cover: draft.images.length === 0 && i === 0,
    }));
    setDraft({ ...draft, images: [...draft.images, ...added].slice(0, 8) });
  };

  const setCover = (idx: number) => {
    setDraft({
      ...draft,
      images: draft.images.map((img, i) => ({ ...img, is_cover: i === idx })),
    });
  };

  const removeImg = (idx: number) => {
    const next = draft.images.filter((_, i) => i !== idx);
    if (next.length > 0 && !next.some((i) => i.is_cover)) next[0].is_cover = true;
    setDraft({ ...draft, images: next });
  };

  const toggleInArr = (arr: string[], v: string) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const canProceed = () => {
    if (step === 0) return draft.latitude != null;
    if (step === 1) return draft.privacy_mode !== 'public' || draft.images.length >= 1;
    if (step === 2) return draft.title.trim() && draft.city.trim();
    return true;
  };

  const submit = async () => {
    if (!draft.latitude || !draft.longitude || !draft.title || !draft.city) {
      Alert.alert('Missing fields', 'Please fill location, title, and city.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/spots', {
        title: draft.title,
        description: draft.description,
        latitude: draft.latitude,
        longitude: draft.longitude,
        city: draft.city,
        state: draft.state,
        privacy_mode: draft.privacy_mode,
        location_display_mode: draft.location_display_mode,
        shoot_types: draft.shoot_types,
        style_tags: draft.style_tags,
        best_time_of_day: draft.best_time_of_day,
        sunrise_rating: draft.sunrise_rating,
        sunset_rating: draft.sunset_rating,
        morning_golden_hour_rating: draft.morning_golden_hour_rating,
        evening_golden_hour_rating: draft.evening_golden_hour_rating,
        shade_rating: draft.shade_rating,
        variety_rating: draft.variety_rating,
        crowd_level: draft.crowd_level,
        safety_rating: draft.safety_rating,
        dog_friendly: draft.dog_friendly,
        kid_friendly: draft.kid_friendly,
        accessible: draft.accessible,
        indoor: draft.indoor,
        permit_required: draft.permit_required,
        fee_required: draft.fee_required,
        parking_notes: draft.parking_notes,
        lens_recommendations: draft.lens_recommendations,
        best_months: [],
        images: draft.images,
      });
      Alert.alert('Spot submitted', draft.privacy_mode === 'public' ? 'Your public spot is in review.' : 'Saved!', [
        { text: 'OK', onPress: () => { setDraft(initialDraft); setStep(0); router.replace('/(tabs)'); } },
      ]);
    } catch (e) {
      Alert.alert('Could not submit', formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={prev} testID="add-back">
            <ChevronLeft color={colors.text} size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{STEPS[step]}</Text>
          <Text style={styles.headerStep}>{step + 1} / {STEPS.length}</Text>
        </View>

        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
        </View>

        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Where did you shoot?</Text>
              <Text style={styles.sub}>Drop a pin or use your current location.</Text>
              <Button title="Use my current location" icon={<MapPin size={18} color={colors.textInverse} />} onPress={useMyLocation} testID="add-use-location" />
              <Input
                label="Or enter coordinates manually (lat, lng)"
                placeholder="30.2672, -97.7431"
                onChangeText={(txt) => {
                  const [lat, lng] = txt.split(',').map((s) => parseFloat(s.trim()));
                  if (!isNaN(lat) && !isNaN(lng)) {
                    setDraft({ ...draft, latitude: lat, longitude: lng, locationLabel: `${lat}, ${lng}` });
                  }
                }}
                testID="add-coords"
              />
              {draft.locationLabel && (
                <>
                  <View style={styles.coordsCard}>
                    <MapPin size={16} color={colors.primary} />
                    <Text style={{ color: colors.text, fontFamily: font.bodyMedium }}>{draft.locationLabel}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.quickSave}
                    onPress={() => { setDraft({ ...draft, privacy_mode: 'private', location_display_mode: 'exact' }); setStep(1); }}
                    testID="add-quick-save"
                  >
                    <Zap size={16} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.quickSaveTitle}>Quick save private</Text>
                      <Text style={styles.quickSaveSub}>Skip the details — log this spot for yourself now, fill in notes later.</Text>
                    </View>
                    <ChevronRight size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {step === 1 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Add photos</Text>
              <Text style={styles.sub}>Public submissions need at least one photo. Tap an image to make it the cover.</Text>
              <TouchableOpacity style={styles.uploadCard} onPress={pickImages} testID="add-pick-images">
                <ImageIcon size={28} color={colors.primary} />
                <Text style={styles.uploadText}>Choose photos</Text>
                <Text style={styles.uploadHint}>Up to 8 images</Text>
              </TouchableOpacity>
              <View style={styles.imgGrid}>
                {draft.images.map((img, i) => (
                  <TouchableOpacity key={i} style={styles.imgWrap} onPress={() => setCover(i)}>
                    <Image source={{ uri: img.image_url }} style={styles.imgThumb} />
                    {img.is_cover && <View style={styles.coverBadge}><Text style={styles.coverTxt}>COVER</Text></View>}
                    <TouchableOpacity style={styles.imgRemove} onPress={() => removeImg(i)}>
                      <X size={14} color="#fff" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {step === 2 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Basic details</Text>
              <Input label="Spot title" value={draft.title} onChangeText={(t) => setDraft({ ...draft, title: t })} placeholder="e.g. Bluebonnet Fields at Muleshoe Bend" testID="add-title" />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 2 }}>
                  <Input label="City" value={draft.city} onChangeText={(t) => setDraft({ ...draft, city: t })} placeholder="Austin" testID="add-city" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="State" value={draft.state} onChangeText={(t) => setDraft({ ...draft, state: t.toUpperCase().slice(0, 2) })} placeholder="TX" testID="add-state" />
                </View>
              </View>
              <Input
                label="Description"
                value={draft.description}
                onChangeText={(t) => setDraft({ ...draft, description: t })}
                multiline
                placeholder="What makes this spot great? Any quirks to know?"
                style={{ minHeight: 100, textAlignVertical: 'top' }}
                testID="add-description"
              />
              <Text style={styles.subSectionLabel}>Shoot types</Text>
              <View style={styles.chipRow}>
                {SHOOT_TYPES.map((t) => (
                  <Chip
                    key={t}
                    label={t}
                    active={draft.shoot_types.includes(t)}
                    onPress={() => setDraft({ ...draft, shoot_types: toggleInArr(draft.shoot_types, t) })}
                    testID={`add-shoot-${t}`}
                  />
                ))}
              </View>
              <Text style={styles.subSectionLabel}>Style tags (e.g. Sunset, Urban, Wildflowers)</Text>
              <Input
                placeholder="Comma separated tags"
                value={draft.style_tags.join(', ')}
                onChangeText={(t) => setDraft({ ...draft, style_tags: t.split(',').map((x) => x.trim()).filter(Boolean) })}
                testID="add-tags"
              />
            </View>
          )}

          {step === 3 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Photographer notes</Text>
              <Text style={styles.sub}>Rate the real conditions so others can plan better.</Text>

              <Text style={styles.subSectionLabel}>Best time of day</Text>
              <View style={styles.chipRow}>
                {BEST_TIMES.map((t) => (
                  <Chip
                    key={t.key}
                    label={t.label}
                    active={draft.best_time_of_day === t.key}
                    onPress={() => setDraft({ ...draft, best_time_of_day: t.key })}
                  />
                ))}
              </View>

              <Rating label="Sunrise quality" value={draft.sunrise_rating} onChange={(v) => setDraft({ ...draft, sunrise_rating: v })} />
              <Rating label="Sunset quality" value={draft.sunset_rating} onChange={(v) => setDraft({ ...draft, sunset_rating: v })} />
              <Rating label="Morning golden hour" value={draft.morning_golden_hour_rating} onChange={(v) => setDraft({ ...draft, morning_golden_hour_rating: v })} />
              <Rating label="Evening golden hour" value={draft.evening_golden_hour_rating} onChange={(v) => setDraft({ ...draft, evening_golden_hour_rating: v })} />
              <Rating label="Shade availability" value={draft.shade_rating} onChange={(v) => setDraft({ ...draft, shade_rating: v })} />
              <Rating label="Background variety" value={draft.variety_rating} onChange={(v) => setDraft({ ...draft, variety_rating: v })} />
              <Rating label="Crowd level (5 = very crowded)" value={draft.crowd_level} onChange={(v) => setDraft({ ...draft, crowd_level: v })} />
              <Rating label="Safety" value={draft.safety_rating} onChange={(v) => setDraft({ ...draft, safety_rating: v })} />

              <View style={{ gap: space.md, marginTop: space.md }}>
                <Toggle label="Dog friendly" value={draft.dog_friendly} onChange={(v) => setDraft({ ...draft, dog_friendly: v })} />
                <Toggle label="Kid friendly" value={draft.kid_friendly} onChange={(v) => setDraft({ ...draft, kid_friendly: v })} />
                <Toggle label="Wheelchair accessible" value={draft.accessible} onChange={(v) => setDraft({ ...draft, accessible: v })} />
                <Toggle label="Indoor" value={draft.indoor} onChange={(v) => setDraft({ ...draft, indoor: v })} />
                <Toggle label="Permit required" value={draft.permit_required} onChange={(v) => setDraft({ ...draft, permit_required: v })} />
                <Toggle label="Fee required" value={draft.fee_required} onChange={(v) => setDraft({ ...draft, fee_required: v })} />
              </View>

              <Input
                label="Parking notes"
                value={draft.parking_notes}
                onChangeText={(t) => setDraft({ ...draft, parking_notes: t })}
                placeholder="Gravel lot, fills up on weekends"
                multiline
                testID="add-parking"
              />
              <Input
                label="Lens recommendations"
                value={draft.lens_recommendations}
                onChangeText={(t) => setDraft({ ...draft, lens_recommendations: t })}
                placeholder="35mm for wide, 85mm for portraits"
                testID="add-lens"
              />
            </View>
          )}

          {step === 4 && (
            <View style={{ gap: space.lg }}>
              <Text style={styles.heading}>Privacy & sharing</Text>
              <Text style={styles.sub}>Control who can see this spot.</Text>
              {PRIVACY_MODES.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => setDraft({ ...draft, privacy_mode: p.key })}
                  style={[styles.privCard, draft.privacy_mode === p.key && styles.privCardActive]}
                  testID={`privacy-${p.key}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 15 }}>{p.label}</Text>
                    <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 4 }}>{p.help}</Text>
                  </View>
                  {draft.privacy_mode === p.key && <Check size={20} color={colors.primary} />}
                </TouchableOpacity>
              ))}

              <Text style={styles.subSectionLabel}>Coordinate display</Text>
              <View style={styles.chipRow}>
                {[
                  { k: 'exact', l: 'Exact' },
                  { k: 'approximate', l: 'Approximate (~1km)' },
                  { k: 'hidden', l: 'Hidden' },
                ].map((m) => (
                  <Chip
                    key={m.k}
                    label={m.l}
                    active={draft.location_display_mode === m.k}
                    onPress={() => setDraft({ ...draft, location_display_mode: m.k })}
                  />
                ))}
              </View>
            </View>
          )}

          {step === 5 && (
            <View style={{ gap: space.md }}>
              <Text style={styles.heading}>Review & submit</Text>
              <View style={styles.reviewRow}><Text style={styles.reviewK}>Title</Text><Text style={styles.reviewV}>{draft.title || '—'}</Text></View>
              <View style={styles.reviewRow}><Text style={styles.reviewK}>Location</Text><Text style={styles.reviewV}>{draft.locationLabel || '—'}</Text></View>
              <View style={styles.reviewRow}><Text style={styles.reviewK}>City</Text><Text style={styles.reviewV}>{draft.city}, {draft.state}</Text></View>
              <View style={styles.reviewRow}><Text style={styles.reviewK}>Photos</Text><Text style={styles.reviewV}>{draft.images.length}</Text></View>
              <View style={styles.reviewRow}><Text style={styles.reviewK}>Shoot types</Text><Text style={styles.reviewV}>{draft.shoot_types.join(', ') || '—'}</Text></View>
              <View style={styles.reviewRow}><Text style={styles.reviewK}>Privacy</Text><Text style={styles.reviewV}>{draft.privacy_mode}</Text></View>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {step < STEPS.length - 1 ? (
            <Button
              title="Continue"
              onPress={next}
              disabled={!canProceed()}
              icon={<ChevronRight size={18} color={colors.textInverse} />}
              testID="add-next"
            />
          ) : (
            <Button title="Submit spot" onPress={submit} loading={submitting} testID="add-submit" />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View>
      <Text style={styles.subSectionLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 2, 3, 4, 5].map((v) => (
          <TouchableOpacity
            key={v}
            onPress={() => onChange(v)}
            style={[styles.ratingDot, value >= v && { backgroundColor: colors.primary, borderColor: colors.primary }]}
          >
            <Text style={{ color: value >= v ? colors.textInverse : colors.textSecondary, fontFamily: font.bodyBold }}>{v}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 15 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.surface3 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: space.xl, paddingVertical: space.md,
  },
  headerTitle: { color: colors.text, fontFamily: font.display, fontSize: 22 },
  headerStep: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
  progress: {
    height: 3, backgroundColor: colors.surface2, marginHorizontal: space.xl, borderRadius: 2,
  },
  progressFill: { height: 3, backgroundColor: colors.primary, borderRadius: 2 },
  heading: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 20 },
  subSectionLabel: {
    color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 6,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  coordsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: space.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    borderRadius: radii.md,
  },
  quickSave: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: space.md, borderWidth: 1, borderColor: colors.primary,
    backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: radii.md,
  },
  quickSaveTitle: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 },
  quickSaveSub: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2, lineHeight: 16 },
  uploadCard: {
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: space.xxxl, paddingHorizontal: space.xl,
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: radii.lg, backgroundColor: colors.surface1,
  },
  uploadText: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 15, marginTop: 6 },
  uploadHint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },
  imgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  imgWrap: { width: '31%', aspectRatio: 1, position: 'relative' },
  imgThumb: { width: '100%', height: '100%', borderRadius: radii.md },
  coverBadge: {
    position: 'absolute', bottom: 6, left: 6,
    backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.sm,
  },
  coverTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9, letterSpacing: 0.4 },
  imgRemove: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center',
  },
  privCard: {
    flexDirection: 'row', alignItems: 'center',
    padding: space.lg, borderRadius: radii.md,
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    gap: space.md,
  },
  privCardActive: { borderColor: colors.primary, backgroundColor: 'rgba(245,166,35,0.08)' },
  ratingDot: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  reviewK: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
  reviewV: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 14, maxWidth: '60%', textAlign: 'right' },
  footer: {
    padding: space.xl, borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
});
