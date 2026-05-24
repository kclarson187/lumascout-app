/**
 * park-drafts.ts — Phase 6 of the Park-Based Multi-Spot Workflow.
 *
 * AsyncStorage-backed queue of unsubmitted child spots. When the
 * /api/spots POST fails due to a network error (offline, timeout,
 * 5xx), the spot payload is parked here so we don't lose the user's
 * work. A background syncer (`useDraftSync`) drains the queue on app
 * foreground + connectivity changes.
 *
 * Design rules:
 *   • Drafts are keyed by a client-generated `local_id` — never a
 *     backend spot_id (we don't have one until upload succeeds).
 *   • The payload is the full SpotCreateIn body, including images
 *     (base64 strings). Photographers working offline may have several
 *     drafts queued up.
 *   • We DO NOT auto-upload silently from list/Explore screens; the
 *     sync hook is mounted only on the Add Spot route + the global app
 *     root, so the user remains the source of truth on retry pacing.
 *   • Each draft has `last_attempt_at` and `last_error` so the UI can
 *     surface stuck drafts (e.g. a 4xx that won't fix itself).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@lumascout:park_drafts:v1';

export type DraftSpot = {
  local_id: string;            // client-generated id
  payload: Record<string, any>; // exact body shape /api/spots expects
  park_group_id?: string | null;
  park_name?: string | null;
  saved_at: number;            // epoch ms
  last_attempt_at?: number | null;
  last_error?: string | null;
  attempts: number;
};

function newLocalId(): string {
  // Cheap UUID-ish; matches the backend's spot_id length so debugging is easy.
  return `localspot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readAll(): Promise<DraftSpot[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(drafts: DraftSpot[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Defensively swallow — failing to write the queue should never
    // crash the host screen.
  }
}

/** Append a new draft. Returns the assigned local_id. */
export async function saveDraft(
  payload: Record<string, any>,
  meta?: { park_group_id?: string | null; park_name?: string | null },
): Promise<string> {
  const drafts = await readAll();
  const draft: DraftSpot = {
    local_id: newLocalId(),
    payload,
    park_group_id: meta?.park_group_id ?? payload?.park_group_id ?? null,
    park_name:     meta?.park_name     ?? payload?.park_name     ?? null,
    saved_at: Date.now(),
    last_attempt_at: null,
    last_error: null,
    attempts: 0,
  };
  drafts.push(draft);
  await writeAll(drafts);
  return draft.local_id;
}

/** Return all drafts ordered oldest-first. */
export async function listDrafts(): Promise<DraftSpot[]> {
  const drafts = await readAll();
  return [...drafts].sort((a, b) => a.saved_at - b.saved_at);
}

/** Return the count without rehydrating the payload (cheap). */
export async function countDrafts(): Promise<number> {
  const drafts = await readAll();
  return drafts.length;
}

/** Remove a draft after a successful upload. */
export async function deleteDraft(local_id: string): Promise<void> {
  const drafts = await readAll();
  await writeAll(drafts.filter((d) => d.local_id !== local_id));
}

/** Update bookkeeping after a failed attempt — does NOT remove. */
export async function markAttemptFailed(local_id: string, errorMessage: string): Promise<void> {
  const drafts = await readAll();
  const next = drafts.map((d) =>
    d.local_id === local_id
      ? { ...d, last_attempt_at: Date.now(), last_error: errorMessage.slice(0, 240), attempts: (d.attempts || 0) + 1 }
      : d,
  );
  await writeAll(next);
}

/** Drop every queued draft (e.g. for "Discard all" recovery). */
export async function clearDrafts(): Promise<void> {
  await writeAll([]);
}

/** Sub for the storage key — exported only for tests / debug. */
export const _DRAFTS_STORAGE_KEY = STORAGE_KEY;
