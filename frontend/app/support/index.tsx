import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, ChevronDown, ChevronRight, MessageSquarePlus, Inbox, HelpCircle } from 'lucide-react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, font, space, radii } from '../../src/theme';
import { Button } from '../../src/components/Button';

type Faq = { id: string; q: string; a: string };
type Ticket = { ticket_id: string; subject: string; status: string; created_at: string; category: string; replies?: any[] };

export default function SupportIndex() {
  const { user } = useAuth();
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [faqRes, ticketRes] = await Promise.all([
        api.get('/support/faqs').catch(() => ({ items: [] })),
        user ? api.get('/me/support/tickets').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      ]);
      setFaqs(faqRes?.items || []);
      setTickets(ticketRes?.items || []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="support-back">
          <ChevronLeft size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>HELP CENTER</Text>
          <Text style={styles.title}>Support Hub</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg, paddingBottom: 80 }}>
        <Text style={styles.lead}>We usually respond within 24 hours on weekdays.</Text>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Contact us" onPress={() => router.push('/support/new')} style={{ flex: 1 }} testID="support-contact" />
          {tickets.length > 0 && (
            <Button title="My tickets" variant="secondary" onPress={() => router.push('/support/mine')} style={{ flex: 1 }} testID="support-my-tickets" />
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md }}>
          <HelpCircle size={15} color={colors.textSecondary} />
          <Text style={styles.sectionLabel}>Frequently asked</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: space.lg }} />
        ) : (
          faqs.map((f) => {
            const isOpen = open === f.id;
            return (
              <TouchableOpacity
                key={f.id}
                style={styles.faqRow}
                onPress={() => setOpen(isOpen ? null : f.id)}
                activeOpacity={0.8}
                testID={`faq-${f.id}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.faqQ}>{f.q}</Text>
                  {isOpen ? <ChevronDown size={16} color={colors.textSecondary} /> : <ChevronRight size={16} color={colors.textSecondary} />}
                </View>
                {isOpen && <Text style={styles.faqA}>{f.a}</Text>}
              </TouchableOpacity>
            );
          })
        )}

        {tickets.length > 0 && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.lg }}>
              <Inbox size={15} color={colors.textSecondary} />
              <Text style={styles.sectionLabel}>Recent tickets</Text>
            </View>
            {tickets.slice(0, 5).map((t) => (
              <TouchableOpacity key={t.ticket_id} style={styles.faqRow} onPress={() => router.push(`/support/mine`)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.faqQ} numberOfLines={1}>{t.subject}</Text>
                  <View style={[styles.statusDot, t.status === 'resolved' && { backgroundColor: colors.success }]}>
                    <Text style={styles.statusTxt}>{t.status.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.faqA}>{new Date(t.created_at).toLocaleDateString()} · {t.category}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11 },
  title: { color: colors.text, fontFamily: font.display, fontSize: 28, letterSpacing: -0.3 },
  lead: { color: colors.textSecondary, fontFamily: font.body, fontSize: 14, lineHeight: 21 },
  sectionLabel: { color: colors.textSecondary, fontFamily: font.bodyBold, fontSize: 11 },
  faqRow: { padding: space.md, backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, gap: 8 },
  faqQ: { color: colors.text, fontFamily: font.bodyBold, fontSize: 14, flex: 1 },
  faqA: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13, lineHeight: 19 },
  statusDot: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.primary },
  statusTxt: { color: colors.textInverse, fontFamily: font.bodyBold, fontSize: 9 } });
