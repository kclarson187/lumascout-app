/**
 * Legacy redirect — /messages/[id] → /inbox/[id]
 *
 * The original Thread component here had a syntax bug inside `useRef`
 * (ScrollView props parsed as generic type arguments) which crashed with
 * "keyboardShouldPersistTaps is not defined" whenever the screen
 * rendered. The DM system has since migrated to /inbox/[id] under the
 * Phase A rebuild. This shim routes old links correctly:
 *   /messages/new?user=USER_ID → start a DM thread via the API and
 *                                redirect to /inbox/{thread_id}.
 *   /messages/<conversation_id> → route to /inbox directly (legacy
 *                                 conversation_ids map 1:1 to the new
 *                                 thread_ids in the DM migration).
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { colors, font } from '../../src/theme';

export default function MessagesLegacyThread() {
  const { id, user: userQ } = useLocalSearchParams<{ id?: string; user?: string }>();

  useEffect(() => {
    (async () => {
      try {
        if (id === 'new' && userQ) {
          const t = await api.post('/dm/threads/start', { user_id: userQ, opening_body: null });
          if (t?.thread_id) {
            router.replace(`/inbox/${t.thread_id}` as any);
            return;
          }
        }
        if (id && id !== 'new') {
          router.replace(`/inbox/${id}` as any);
          return;
        }
        router.replace('/inbox' as any);
      } catch (e) {
        router.replace('/inbox' as any);
      }
    })();
  }, [id, userQ]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.hint}>Opening message…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: 12 },
  hint: { color: colors.textSecondary, fontFamily: font.body, fontSize: 13 },
});
