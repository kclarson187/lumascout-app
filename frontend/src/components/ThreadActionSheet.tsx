/**
 * ThreadActionSheet — bottom-sheet modal triggered by long-pressing
 * an inbox thread row. Offers the four Tier 1 actions:
 *   · Delete Chat      (soft-hide for the viewer only, DELETE /dm/threads/:id)
 *   · Mute / Unmute    (POST /dm/threads/:id/mute toggles is_muted)
 *   · Block user       (POST /users/:uid/block)
 *   · Report user      (delegates to ReportSheet, target_type='user')
 *
 * Confirmation copy per PRD: on Delete Chat we show
 *   "Delete this chat from your inbox? The other user will still keep
 *   their copy."
 *
 * Tier 1 Messaging Upgrade (2026-04).
 */
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import { Trash2, BellOff, Bell, ShieldOff, Flag, X, Archive, ArchiveRestore, Pin, PinOff } from 'lucide-react-native';
import { api, formatApiError } from '../api';
import { colors, font, radii, space } from '../theme';
import ReportSheet from './ReportSheet';

export type ThreadActionTarget = {
  thread_id: string;
  other_user_id?: string | null;
  other_name?: string | null;
  is_muted?: boolean;
  is_archived?: boolean;
  is_pinned?: boolean;
};

export default function ThreadActionSheet({
  visible,
  target,
  onClose,
  onDeleted,
  onMuted,
  onBlocked,
  onArchived,
  onPinned,
}: {
  visible: boolean;
  target: ThreadActionTarget | null;
  onClose: () => void;
  onDeleted?: (threadId: string) => void;
  onMuted?: (threadId: string, isMuted: boolean) => void;
  onBlocked?: (userId: string) => void;
  onArchived?: (threadId: string, isArchived: boolean) => void;
  onPinned?: (threadId: string, isPinned: boolean) => void;
}) {
  const [reportVisible, setReportVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleArchive = async () => {
    if (!target) return;
    setBusy(true);
    try {
      if (target.is_archived) {
        await api.delete(`/dm/threads/${target.thread_id}/archive`);
        onArchived?.(target.thread_id, false);
      } else {
        await api.post(`/dm/threads/${target.thread_id}/archive`, {});
        onArchived?.(target.thread_id, true);
      }
      onClose();
    } catch (e: any) {
      Alert.alert('Could not update', formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const handlePin = async () => {
    if (!target) return;
    setBusy(true);
    try {
      if (target.is_pinned) {
        await api.delete(`/dm/threads/${target.thread_id}/pin`);
        onPinned?.(target.thread_id, false);
        onClose();
      } else {
        await api.post(`/dm/threads/${target.thread_id}/pin`, {});
        onPinned?.(target.thread_id, true);
        onClose();
      }
    } catch (e: any) {
      // 409 = pin cap reached. Show the server's helpful message verbatim.
      Alert.alert('Pin limit reached', formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    if (!target) return;
    Alert.alert(
      'Delete Chat',
      'Delete this chat from your inbox?\nThe other user will still keep their copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!target) return;
            setBusy(true);
            try {
              await api.delete(`/dm/threads/${target.thread_id}`);
              onDeleted?.(target.thread_id);
              onClose();
            } catch (e: any) {
              Alert.alert('Could not delete', formatApiError(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleMute = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await api.post(`/dm/threads/${target.thread_id}/mute`, {});
      onMuted?.(target.thread_id, !!r.is_muted);
      onClose();
    } catch (e: any) {
      Alert.alert('Could not update', formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleBlock = () => {
    if (!target?.other_user_id) return;
    Alert.alert(
      'Block user',
      `Block ${target.other_name || 'this user'}? They won't be able to message or follow you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            if (!target?.other_user_id) return;
            setBusy(true);
            try {
              await api.post(`/users/${target.other_user_id}/block`, {});
              onBlocked?.(target.other_user_id);
              onClose();
            } catch (e: any) {
              Alert.alert('Could not block', formatApiError(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const handleReport = () => {
    setReportVisible(true);
  };

  const isMuted = !!target?.is_muted;

  return (
    <>
      <Modal
        visible={visible && !reportVisible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <Pressable style={s.backdrop} onPress={onClose}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.grabber} />
            <View style={s.header}>
              <Text style={s.title} numberOfLines={1}>
                {target?.other_name || 'Conversation'}
              </Text>
              <Pressable onPress={onClose} style={s.closeBtn} testID="thread-actions-close">
                <X size={18} color={colors.textSecondary} />
              </Pressable>
            </View>

            <Pressable
              style={s.item}
              onPress={handlePin}
              disabled={busy}
              testID="thread-action-pin"
            >
              {target?.is_pinned ? (
                <PinOff size={18} color={colors.text} />
              ) : (
                <Pin size={18} color="#f5a623" />
              )}
              <Text style={s.itemTxt}>{target?.is_pinned ? 'Unpin' : 'Pin to top'}</Text>
            </Pressable>

            <Pressable
              style={s.item}
              onPress={handleArchive}
              disabled={busy}
              testID="thread-action-archive"
            >
              {target?.is_archived ? (
                <ArchiveRestore size={18} color={colors.text} />
              ) : (
                <Archive size={18} color={colors.text} />
              )}
              <Text style={s.itemTxt}>{target?.is_archived ? 'Unarchive' : 'Archive'}</Text>
            </Pressable>

            <Pressable
              style={s.item}
              onPress={handleMute}
              disabled={busy}
              testID="thread-action-mute"
            >
              {isMuted ? (
                <Bell size={18} color={colors.text} />
              ) : (
                <BellOff size={18} color={colors.text} />
              )}
              <Text style={s.itemTxt}>{isMuted ? 'Unmute' : 'Mute notifications'}</Text>
            </Pressable>

            {target?.other_user_id ? (
              <>
                <Pressable
                  style={s.item}
                  onPress={handleBlock}
                  disabled={busy}
                  testID="thread-action-block"
                >
                  <ShieldOff size={18} color={colors.text} />
                  <Text style={s.itemTxt}>Block user</Text>
                </Pressable>
                <Pressable
                  style={s.item}
                  onPress={handleReport}
                  disabled={busy}
                  testID="thread-action-report"
                >
                  <Flag size={18} color={colors.text} />
                  <Text style={s.itemTxt}>Report user</Text>
                </Pressable>
              </>
            ) : null}

            <View style={s.separator} />

            <Pressable
              style={[s.item, s.itemDanger]}
              onPress={handleDelete}
              disabled={busy}
              testID="thread-action-delete"
            >
              <Trash2 size={18} color="#ef4444" />
              <Text style={[s.itemTxt, s.itemTxtDanger]}>Delete Chat</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {target?.other_user_id ? (
        <ReportSheet
          visible={reportVisible}
          onClose={() => {
            setReportVisible(false);
            onClose();
          }}
          targetType="user"
          targetId={target.other_user_id}
          onSubmitted={() => {
            setReportVisible(false);
            onClose();
          }}
          title={`Report ${target.other_name || 'user'}`}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface1,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: space.md,
    paddingTop: 8,
    paddingBottom: space.xxl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    marginBottom: 4,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 15,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  itemTxt: {
    color: colors.text,
    fontFamily: font.bodyMedium,
    fontSize: 14,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  itemDanger: {},
  itemTxtDanger: {
    color: '#ef4444',
    fontFamily: font.bodySemibold,
  },
});
