/**
 * Referral Detail + Apply/Manage
 * Path: /referrals/[id]
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, Stack, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, MapPin, Clock, DollarSign, Zap, Users, MessageCircle,
  CheckCircle2, XCircle, Briefcase, AlertCircle,
} from 'lucide-react-native';
import { api, formatApiError } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import KeyboardSafe from '../../src/components/KeyboardSafe';
import VerifiedBadge from '../../src/components/VerifiedBadge';
import type { ReferralNeed } from '../../src/components/ReferralCard';

const GIG_LABELS: Record<string, string> = {
  full_session_referral: 'Full Session Referral',
  second_shooter: 'Second Shooter',
  associate_shooter: 'Associate Shooter',
  content_creator: 'Content Creator',
  pet_session: 'Pet Session',
  wedding_support: 'Wedding Support',
  event_coverage: 'Event Coverage',
};

type Application = {
  app_id: string;
  need_id: string;
  applicant_user_id: string;
  pitch?: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  thread_id?: string;
  created_at: string;
  applicant?: { user_id: string; name: string; username?: string; avatar_url?: string | null; city?: string; specialties?: string[]; plan?: string; verification_status?: string } | null;
};

export default function ReferralDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [need, setNeed] = useState<(ReferralNeed & { applications?: Application[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pitch, setPitch] = useState('');
  const [showPitch, setShowPitch] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/referrals/${id}`);
      setNeed(res);
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onApply = async () => {
    if (!showPitch) { setShowPitch(true); return; }
    setBusy(true);
    try {
      const res = await api.post(`/referrals/${id}/apply`, { pitch: pitch.trim() || null });
      if (res?.thread_id) {
        Alert.alert('Applied! 🎉', 'Your application was sent and a message thread was opened with the poster.', [
          { text: 'Open Chat', onPress: () => router.push(`/inbox/${res.thread_id}` as any) },
          { text: 'Done', style: 'cancel' },
        ]);
      }
      setPitch('');
      setShowPitch(false);
      load();
    } catch (e: any) {
      const msg = formatApiError(e);
      if (e?.response?.status === 402) {
        Alert.alert('Upgrade needed', msg, [
          { text: 'Go Pro', onPress: () => router.push('/paywall?reason=referrals' as any) },
          { text: 'Later', style: 'cancel' },
        ]);
      } else {
        Alert.alert('Could not apply', msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onAccept = async (appId: string) => {
    setBusy(true);
    try {
      await api.post(`/referrals/${id}/applications/${appId}/accept`);
      await load();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally { setBusy(false); }
  };

  const onReject = async (appId: string) => {
    setBusy(true);
    try {
      await api.post(`/referrals/${id}/applications/${appId}/reject`);
      await load();
    } catch (e) {
      Alert.alert('Error', formatApiError(e));
    } finally { setBusy(false); }
  };

  const onClose = async () => {
    Alert.alert('Close this need?', 'Applicants will no longer be able to apply.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          await api.patch(`/referrals/${id}`, { status: 'closed' });
          await load();
        } catch (e) { Alert.alert('Error', formatApiError(e)); }
        setBusy(false);
      }},
    ]);
  };

  const onReopen = async () => {
    setBusy(true);
    try {
      await api.patch(`/referrals/${id}`, { status: 'open' });
      await load();
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
    setBusy(false);
  };

  const onMessagePoster = async () => {
    if (need?.my_application?.thread_id) {
      router.push(`/inbox/${need.my_application.thread_id}` as any);
      return;
    }
    if (!need?.poster?.user_id) return;
    try {
      const r = await api.post('/dm/threads/start', { user_id: need.poster.user_id, opening_body: null });
      if (r?.thread_id) router.push(`/inbox/${r.thread_id}` as any);
    } catch (e) { Alert.alert('Error', formatApiError(e)); }
  };

  if (loading || !need) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
            <ArrowLeft size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Referral</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const isMine = need.is_mine;
  const myApp = need.my_application;
  const city = [need.city, need.state].filter(Boolean).join(', ');
  const gigLabel = GIG_LABELS[need.gig_type] || need.gig_type;
  const isOpen = need.status === 'open' || need.status === 'reviewing';
  const canApply = !isMine && !myApp && isOpen;

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10} testID="referral-back">
          <ArrowLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Referral</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardSafe>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 140, gap: space.lg }}>
          {/* Hero */}
          <View style={styles.heroCard}>
            <View style={styles.badgeRow}>
              <View style={styles.gigPill}>
                <Briefcase size={11} color={colors.primary} />
                <Text style={styles.gigPillTxt}>{gigLabel}</Text>
              </View>
              {need.urgency === 'urgent' ? (
                <View style={styles.urgentPill}>
                  <Zap size={10} color={colors.textInverse} />
                  <Text style={styles.urgentTxt}>URGENT</Text>
                </View>
              ) : null}
              {need.is_featured ? (
                <View style={styles.featuredPill}><Text style={styles.featuredTxt}>★ FEATURED</Text></View>
              ) : null}
              <View style={styles.statusPill}>
                <Text style={styles.statusTxt}>{need.status.toUpperCase()}</Text>
              </View>
            </View>

            <Text style={styles.title}>{need.title}</Text>

            <View style={styles.metaRow}>
              {city ? (<View style={styles.metaItem}><MapPin size={14} color={colors.textTertiary} /><Text style={styles.metaTxt}>{city}</Text></View>) : null}
              {need.event_date ? (<View style={styles.metaItem}><Clock size={14} color={colors.textTertiary} /><Text style={styles.metaTxt}>{new Date(need.event_date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</Text></View>) : null}
              {need.duration_hours ? (<View style={styles.metaItem}><Clock size={14} color={colors.textTertiary} /><Text style={styles.metaTxt}>{need.duration_hours}h</Text></View>) : null}
              {(need.budget_min || need.budget_max) ? (<View style={styles.metaItem}><DollarSign size={14} color={colors.primary} /><Text style={[styles.metaTxt, { color: colors.primary }]}>${need.budget_min || need.budget_max}{need.budget_min && need.budget_max ? `–$${need.budget_max}` : ''}</Text></View>) : null}
            </View>
          </View>

          {/* Notes */}
          {need.notes ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Details</Text>
              <Text style={styles.notes}>{need.notes}</Text>
            </View>
          ) : null}

          {/* Poster */}
          <TouchableOpacity
            style={styles.posterCard}
            onPress={() => router.push(`/user/${need.poster?.user_id}` as any)}
            activeOpacity={0.85}
          >
            <Text style={styles.sectionLabel}>Posted by</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {need.poster?.avatar_url ? (
                <Image source={{ uri: need.poster.avatar_url }} style={styles.posterAvatar} />
              ) : (
                <View style={[styles.posterAvatar, { backgroundColor: colors.surface2 }]} />
              )}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.posterName}>{need.poster?.name}</Text>
                  {need.poster?.verification_status === 'verified' && <VerifiedBadge size={12} />}
                </View>
                <Text style={styles.posterMeta}>
                  @{need.poster?.username} · {need.poster?.city || 'Photographer'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Applicants (poster only) */}
          {isMine && need.applications ? (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.sectionLabel}>Applicants ({need.applications.length})</Text>
                {isOpen ? (
                  <TouchableOpacity onPress={onClose} disabled={busy}>
                    <Text style={styles.linkDanger}>Close listing</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={onReopen} disabled={busy}>
                    <Text style={styles.linkPrimary}>Reopen</Text>
                  </TouchableOpacity>
                )}
              </View>
              {need.applications.length === 0 ? (
                <Text style={styles.emptyTxt}>No applicants yet. Share your listing to get more visibility.</Text>
              ) : (
                need.applications.map((a) => <ApplicantRow key={a.app_id} app={a} busy={busy} onAccept={() => onAccept(a.app_id)} onReject={() => onReject(a.app_id)} onMessage={() => a.thread_id && router.push(`/inbox/${a.thread_id}` as any)} />)
              )}
            </View>
          ) : null}

          {/* Apply composer */}
          {canApply && showPitch ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Your pitch</Text>
              <TextInput
                value={pitch}
                onChangeText={setPitch}
                multiline
                maxLength={1000}
                placeholder="Hi! I shoot families in Austin weekly. Happy to send portfolio + rates."
                placeholderTextColor={colors.textTertiary}
                style={styles.pitchInput}
              />
              <Text style={styles.pitchHint}>
                Your portfolio + profile are sent automatically. A DM thread opens with the poster.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardSafe>

      {/* Bottom action bar */}
      {canApply ? (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.bottomBtn, styles.bottomBtnPrimary, busy && { opacity: 0.7 }]}
            onPress={onApply}
            disabled={busy}
            testID="referral-apply"
          >
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <>
              <Briefcase size={15} color={colors.textInverse} />
              <Text style={styles.bottomBtnTxt}>{showPitch ? 'Send application' : 'Apply to this need'}</Text>
            </>}
          </TouchableOpacity>
        </View>
      ) : myApp ? (
        <View style={styles.bottomBar}>
          <View style={styles.appStatusPill}>
            {myApp.status === 'accepted' ? <CheckCircle2 size={14} color={colors.success} /> : <AlertCircle size={14} color={colors.textSecondary} />}
            <Text style={styles.appStatusTxt}>
              Application {myApp.status === 'accepted' ? 'accepted ✓' : myApp.status === 'rejected' ? 'not selected' : 'pending'}
            </Text>
          </View>
          <TouchableOpacity style={[styles.bottomBtn, styles.bottomBtnSecondary]} onPress={onMessagePoster}>
            <MessageCircle size={14} color={colors.primary} />
            <Text style={[styles.bottomBtnTxt, { color: colors.primary }]}>Message poster</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function ApplicantRow({ app, busy, onAccept, onReject, onMessage }: {
  app: Application; busy: boolean; onAccept: () => void; onReject: () => void; onMessage: () => void;
}) {
  const a = app.applicant;
  return (
    <View style={styles.applicantRow}>
      {a?.avatar_url ? (
        <Image source={{ uri: a.avatar_url }} style={styles.appAvatar} />
      ) : (
        <View style={[styles.appAvatar, { backgroundColor: colors.surface2 }]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.appName}>{a?.name || 'Applicant'}</Text>
        <Text style={styles.appMeta} numberOfLines={1}>
          {a?.city ? `${a.city} · ` : ''}{(a?.specialties || []).slice(0, 2).join(', ')}
        </Text>
        {app.pitch ? <Text style={styles.pitchTxt} numberOfLines={3}>{app.pitch}</Text> : null}
        <View style={styles.applicantActions}>
          {app.status === 'pending' ? (
            <>
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnPrimary]} onPress={onAccept} disabled={busy}>
                <CheckCircle2 size={12} color={colors.textInverse} />
                <Text style={styles.smallBtnTxtPrimary}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGhost]} onPress={onReject} disabled={busy}>
                <XCircle size={12} color={colors.textSecondary} />
                <Text style={styles.smallBtnTxtGhost}>Reject</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={[styles.smallBtn, styles.smallBtnGhost]}>
              <Text style={styles.smallBtnTxtGhost}>{app.status}</Text>
            </View>
          )}
          <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGhost]} onPress={onMessage}>
            <MessageCircle size={12} color={colors.primary} />
            <Text style={[styles.smallBtnTxtGhost, { color: colors.primary }]}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontFamily: font.bodyBold, fontSize: 16 },

  heroCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: 'rgba(245,166,35,0.28)',
    borderRadius: radii.lg, padding: space.lg, gap: space.md,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  gigPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.sm,
    backgroundColor: 'rgba(245,166,35,0.12)',
  },
  gigPillTxt: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.4 },
  urgentPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: '#ef4444' },
  urgentTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6 },
  featuredPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: colors.primary },
  featuredTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6 },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm,
    backgroundColor: colors.surface2,
  },
  statusTxt: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6 },

  title: { color: colors.text, fontFamily: font.display, fontSize: 22, letterSpacing: -0.3, lineHeight: 28 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 13 },

  card: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: space.md, gap: space.sm,
  },
  sectionLabel: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  notes: { color: colors.text, fontFamily: font.body, fontSize: 14, lineHeight: 21 },

  posterCard: {
    backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: space.md, gap: space.sm,
  },
  posterAvatar: { width: 44, height: 44, borderRadius: 22 },
  posterName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14 },
  posterMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 12 },

  emptyTxt: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, textAlign: 'center', paddingVertical: space.md },

  applicantRow: {
    flexDirection: 'row', gap: 10, paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  appAvatar: { width: 38, height: 38, borderRadius: 19 },
  appName: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13 },
  appMeta: { color: colors.textSecondary, fontFamily: font.body, fontSize: 11, marginTop: 2 },
  pitchTxt: { color: colors.text, fontFamily: font.body, fontSize: 12, lineHeight: 17, marginTop: 6 },
  applicantActions: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },

  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.sm,
  },
  smallBtnPrimary: { backgroundColor: colors.primary },
  smallBtnGhost: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  smallBtnTxtPrimary: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 11 },
  smallBtnTxtGhost: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11 },

  pitchInput: {
    backgroundColor: colors.bg, color: colors.text, fontFamily: font.body, fontSize: 14,
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    padding: space.md, minHeight: 100, textAlignVertical: 'top',
  },
  pitchHint: { color: colors.textTertiary, fontFamily: font.body, fontSize: 11 },

  linkPrimary: { color: colors.primary, fontFamily: font.bodyBold, fontSize: 12 },
  linkDanger: { color: '#ef4444', fontFamily: font.bodyBold, fontSize: 12 },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: space.md, gap: space.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  bottomBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: radii.md,
  },
  bottomBtnPrimary: { backgroundColor: colors.primary },
  bottomBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)' },
  bottomBtnTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 14 },

  appStatusPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: 8, borderRadius: radii.sm,
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  appStatusTxt: { color: colors.textSecondary, fontFamily: font.bodyMedium, fontSize: 12 },
});
