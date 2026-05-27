import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import SafeImage from '../../src/components/SafeImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Plus, Crown, Package, DollarSign, X, Check } from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/ui';

export default function CreatorPacks() {
  const { user } = useAuth();
  const [packs, setPacks] = useState<any[]>([]);
  const [mySpots, setMySpots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', price_cents: '1500', spot_ids: [] as string[], published: false });

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.get('/me/packs'), api.get('/me/spots')]);
      setPacks(p);
      setMySpots(s);
    } catch (e) {
      // silent
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!user) return null;

  const isElite = user.plan === 'elite';

  const toggleSpot = (id: string) => {
    setForm((f) => ({
      ...f,
      spot_ids: f.spot_ids.includes(id) ? f.spot_ids.filter((x) => x !== id) : [...f.spot_ids, id],
    }));
  };

  const submit = async () => {
    if (!form.name || form.spot_ids.length === 0) {
      Alert.alert('Add a name + at least one spot');
      return;
    }
    try {
      await api.post('/packs', {
        name: form.name,
        description: form.description,
        price_cents: parseInt(form.price_cents) || 0,
        spot_ids: form.spot_ids,
        published: form.published,
      });
      setCreating(false);
      setForm({ name: '', description: '', price_cents: '1500', spot_ids: [], published: false });
      load();
    } catch (e) {
      Alert.alert('Could not create pack', formatApiError(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="packs-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Creator studio</Text>
      </View>

      {!isElite ? (
        <View style={{ padding: space.xl }}>
          <View style={styles.gateCard}>
            <Crown size={28} color={colors.primary} />
            <Text style={styles.gateTitle}>Elite unlocks creator packs</Text>
            <Text style={styles.gateBody}>
              Package your best spots into a curated guide and sell it to other photographers. Marketplace launches with Stripe next release — we'll migrate your packs automatically.
            </Text>
            <Button title="Upgrade to Elite" onPress={() => router.push('/paywall')} testID="packs-upgrade" style={{ marginTop: space.md }} />
          </View>
        </View>
      ) : loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" contentContainerStyle={{ padding: space.xl, gap: space.md, paddingBottom: 80 }}>
          <Button
            title="New pack"
            icon={<Plus size={18} color={colors.textInverse} />}
            onPress={() => setCreating(true)}
            testID="packs-new"
          />
          {packs.length === 0 ? (
            <EmptyState title="No packs yet" subtitle="Bundle your best shoot locations into a pack. Publish to the marketplace when it launches." />
          ) : (
            packs.map((p) => (
              <View key={p.pack_id} style={styles.packCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.packIcon}><Package size={22} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.packName}>{p.name}</Text>
                    <Text style={styles.packMeta}>{(p.spot_ids || []).length} spots · ${(p.price_cents / 100).toFixed(2)} · {p.published ? 'Published' : 'Draft'}</Text>
                  </View>
                </View>
                {p.description ? <Text style={styles.packDesc}>{p.description}</Text> : null}
                <View style={styles.packStats}>
                  <Stat label="Waitlist" value={p.sales_count || 0} />
                  <Stat label="Earnings" value={`$${((p.sales_count || 0) * (p.price_cents / 100)).toFixed(2)}`} />
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal transparent visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
        <View style={styles.modalBg}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={{ color: colors.text, fontFamily: font.display, fontSize: 24 }}>New pack</Text>
              <TouchableOpacity onPress={() => setCreating(false)}><X size={22} color={colors.text} /></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
              <TextInput
                placeholder="Pack name"
                placeholderTextColor={colors.textTertiary}
                value={form.name}
                onChangeText={(t) => setForm({ ...form, name: t })}
                style={styles.input}
                testID="pack-name"
              />
              <TextInput
                placeholder="Description — what makes this pack worth buying?"
                placeholderTextColor={colors.textTertiary}
                value={form.description}
                onChangeText={(t) => setForm({ ...form, description: t })}
                multiline
                style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                testID="pack-desc"
              />
              <View>
                <Text style={styles.label}>Price (USD)</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <DollarSign size={18} color={colors.textSecondary} />
                  <TextInput
                    value={(parseInt(form.price_cents) / 100).toString()}
                    onChangeText={(t) => setForm({ ...form, price_cents: String(Math.round(parseFloat(t || '0') * 100)) })}
                    keyboardType="numeric"
                    style={[styles.input, { flex: 1 }]}
                    testID="pack-price"
                  />
                </View>
              </View>
              <View>
                <Text style={styles.label}>Include spots ({form.spot_ids.length})</Text>
                <View style={{ gap: 8 }}>
                  {mySpots.length === 0 && <Text style={{ color: colors.textSecondary, fontFamily: font.body }}>Add some spots first.</Text>}
                  {mySpots.map((s) => {
                    const active = form.spot_ids.includes(s.spot_id);
                    return (
                      <TouchableOpacity
                        key={s.spot_id}
                        onPress={() => toggleSpot(s.spot_id)}
                        style={[styles.spotRow, active && { borderColor: colors.primary }]}
                        testID={`pack-spot-${s.spot_id}`}
                      >
                        {s.images?.[0]?.image_url ? (
                          <SafeImage source={{ uri: s.images[0].image_url }} style={styles.spotThumb} />
                        ) : <View style={[styles.spotThumb, { backgroundColor: colors.surface2 }]} />}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontFamily: font.bodySemibold, fontSize: 14 }}>{s.title}</Text>
                          <Text style={{ color: colors.textSecondary, fontFamily: font.body, fontSize: 12 }}>{s.city}, {s.state}</Text>
                        </View>
                        {active && <Check size={18} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setForm({ ...form, published: !form.published })}
                style={[styles.publishToggle, form.published && { borderColor: colors.success }]}
                testID="pack-publish-toggle"
              >
                <View style={[styles.tgl, form.published && { backgroundColor: colors.success }]}>
                  {form.published && <Check size={12} color={colors.textInverse} />}
                </View>
                <Text style={{ color: colors.text, fontFamily: font.bodyMedium, fontSize: 13, flex: 1 }}>
                  Publish to marketplace when it launches
                </Text>
              </TouchableOpacity>
              <Button title="Create pack" onPress={submit} testID="pack-create" />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 10,}}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: font.bodyBold, fontSize: 16, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, paddingVertical: space.md, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.display, fontSize: 26 },
  gateCard: {
    padding: space.xl, backgroundColor: colors.surface1,
    borderColor: colors.primary, borderWidth: 1, borderRadius: radii.lg,
    gap: 10,
  },
  gateTitle: { color: colors.text, fontFamily: font.display, fontSize: 22, marginTop: space.sm },
  gateBody: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 20 },
  packCard: {
    padding: space.lg, backgroundColor: colors.surface1,
    borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, gap: space.md,
  },
  packIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  packName: { color: colors.text, fontFamily: font.bodySemibold, fontSize: 16 },
  packMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12, marginTop: 2 },
  packDesc: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  packStats: { flexDirection: 'row', gap: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface1, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.sm },
  input: {
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: space.md, paddingVertical: 12, borderRadius: radii.md,
    color: colors.text, fontFamily: font.body, fontSize: 15,
  },
  label: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 11, marginBottom: 8 },
  spotRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: space.sm, borderRadius: radii.md, backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
  },
  spotThumb: { width: 48, height: 48, borderRadius: radii.sm },
  publishToggle: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    padding: space.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  tgl: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.textSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
});
