/**
 * UsernameField — text input with debounced live availability check.
 *
 * Hits `GET /api/users/username-available?u=<value>` ~400ms after the
 * user stops typing. Shows ✓ / ✗ / spinner inline, plus a precise
 * helper message based on the backend `reason` payload.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { FormField } from './FormField';
import { api } from '../api';
import { colors } from '../theme';

type Reason = 'empty' | 'too_short' | 'too_long' | 'invalid_chars' | 'reserved' | 'taken' | null;
type Status = 'idle' | 'checking' | 'ok' | 'bad';

const REASON_COPY: Record<Exclude<Reason, null>, string> = {
  empty: 'Pick a username so people can find you.',
  too_short: 'Your username must be 3–24 characters.',
  too_long: 'Your username must be 3–24 characters.',
  invalid_chars: 'Lowercase letters, numbers, and underscores only.',
  reserved: 'That username is reserved. Try another.',
  taken: 'That username is taken. Try one of these.',
};

export function UsernameField({
  value,
  onChangeText,
  testID,
  required,
}: {
  value: string;
  onChangeText: (v: string) => void;
  testID?: string;
  required?: boolean;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [reason, setReason] = useState<Reason>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChecked = useRef<string>('');

  // Normalize as the user types — strip whitespace + leading @, lowercase
  const handleChange = useCallback((next: string) => {
    const cleaned = next.trim().replace(/^@/, '').toLowerCase().replace(/\s+/g, '');
    onChangeText(cleaned);
  }, [onChangeText]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!value) {
      setStatus('idle'); setReason(null);
      return;
    }
    setStatus('checking');
    timer.current = setTimeout(async () => {
      if (lastChecked.current === value) return;
      lastChecked.current = value;
      try {
        const r = await api.get('/users/username-available', { u: value });
        if (r?.available) { setStatus('ok'); setReason(null); }
        else              { setStatus('bad'); setReason((r?.reason as Reason) || 'invalid_chars'); }
      } catch {
        // Network blip — don't block typing. Surface as idle (no error).
        setStatus('idle'); setReason(null);
      }
    }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]);

  const trailing = (
    <View style={styles.trail}>
      {status === 'checking' ? (
        <ActivityIndicator size="small" color={colors.textTertiary} />
      ) : status === 'ok' ? (
        <Check size={16} color={colors.success} />
      ) : status === 'bad' ? (
        <X size={16} color={colors.secondary} />
      ) : null}
    </View>
  );

  const helperText =
    status === 'idle' ? 'Lowercase letters, numbers, and underscores.'
    : status === 'checking' ? 'Checking availability…'
    : status === 'ok' ? 'Looks good — this username is available.'
    : null;

  const errorText = (status === 'bad' && reason) ? REASON_COPY[reason] : null;

  return (
    <FormField
      label="Username"
      value={value}
      onChangeText={handleChange}
      placeholder="yourhandle"
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={24}
      required={required}
      helper={helperText || undefined}
      error={errorText}
      success={status === 'ok'}
      trailing={trailing}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  trail: { width: 22, alignItems: 'center', justifyContent: 'center' },
});
