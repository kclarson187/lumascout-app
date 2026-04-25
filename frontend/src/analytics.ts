/**
 * analytics.ts — lightweight client-side event tracker.
 *
 *   Drop-in module for the launch-readiness sprint. Captures the 10
 *   growth-critical events from the PRD and posts them to a backend
 *   endpoint when one exists. If the endpoint isn't wired yet, events
 *   are buffered in a small in-memory ring (max 200) so we don't lose
 *   them on app start; the buffer flushes on next successful send.
 *
 *   Events ride alongside Sentry breadcrumbs once Sentry is installed
 *   (P1 follow-up). Until then they no-op silently in production but
 *   still fire the buffer-flush hook so wiring Sentry/Mixpanel later
 *   is a one-line drop-in.
 *
 *   USAGE:
 *     import { track } from '@/src/analytics';
 *     track('paywall_viewed', { plan: 'pro' });
 */
import { Platform } from 'react-native';
import { api } from './api';

export type AnalyticsEvent =
  | 'signup_started'
  | 'signup_completed'
  | 'paywall_viewed'
  | 'trial_started'
  | 'subscription_started'
  | 'spot_saved'
  | 'message_sent'
  | 'follow_user'
  | 'upload_spot'
  | 'push_opened'
  | 'app_opened';

type EventPayload = Record<string, string | number | boolean | null | undefined>;

const RING_MAX = 200;
const ring: Array<{ event: AnalyticsEvent; props: EventPayload; t: number }> = [];
let backendAlive: boolean | null = null;

async function flush() {
  if (ring.length === 0) return;
  if (backendAlive === false) return; // Backed off — don't hammer
  const batch = ring.splice(0, ring.length);
  try {
    // Best-effort POST. Backend can no-op (404) and we'll back off.
    await api.post('/analytics/track', {
      events: batch.map((e) => ({
        event: e.event,
        props: e.props,
        ts: e.t,
        platform: Platform.OS,
      })),
    });
    backendAlive = true;
  } catch (err: any) {
    // 404 = endpoint not wired yet — back off permanently this session
    // so we don't burn battery retrying. Anything else is transient.
    if (err?.response?.status === 404) backendAlive = false;
    // Re-buffer up to RING_MAX so events aren't lost while we wait
    if (ring.length < RING_MAX) {
      ring.push(...batch.slice(0, RING_MAX - ring.length));
    }
  }
}

export function track(event: AnalyticsEvent, props: EventPayload = {}) {
  ring.push({ event, props, t: Date.now() });
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  // Fire-and-forget flush — debounced minimally via microtask queue
  Promise.resolve().then(flush).catch(() => {});
}
