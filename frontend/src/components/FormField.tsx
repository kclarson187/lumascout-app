/**
 * FormField — premium dark text input used across signup/onboarding v2.
 *
 * States supported (per the spec):
 *   • default, focused, typing, success, error, disabled
 *
 * Visual treatment:
 *   • Black background, hairline border, gold focus ring
 *   • Helper text is small, secondary; only shown when present
 *   • Error text replaces helper on error — never both at once
 *   • Trailing slot for inline indicators (✓ / ✗ / spinner)
 */
import React, { useState, useCallback, forwardRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, font, space, radii } from '../theme';

export type FormFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  helper?: string;
  error?: string | null;
  success?: boolean;
  required?: boolean;
  trailing?: React.ReactNode;
  containerStyle?: ViewStyle;
  testID?: string;
};

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, helper, error, success, required, trailing, containerStyle, onFocus, onBlur, editable = true, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);

  const handleFocus = useCallback((e: any) => { setFocused(true); onFocus?.(e); }, [onFocus]);
  const handleBlur  = useCallback((e: any) => { setFocused(false); onBlur?.(e); }, [onBlur]);

  const showError = !!error;
  const showSuccess = !showError && !!success;

  const borderColor = !editable ? colors.borderSubtle
    : showError  ? colors.secondary
    : showSuccess ? colors.success
    : focused    ? colors.primary
    : colors.border;

  return (
    <View style={containerStyle}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {required ? <Text style={styles.req}>required</Text> : null}
      </View>
      <View style={[styles.fieldWrap, { borderColor }, !editable && styles.fieldWrapDisabled]}>
        <TextInput
          ref={ref}
          editable={editable}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, !editable && styles.inputDisabled]}
          {...rest}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {showError ? (
        <Text style={styles.errorTxt} numberOfLines={2}>{error}</Text>
      ) : helper ? (
        <Text style={styles.helper} numberOfLines={2}>{helper}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    marginBottom: 6 },
  label: {
    color: colors.text, fontFamily: font.bodySemibold, fontSize: 13 },
  req: {
    color: colors.textTertiary, fontFamily: font.bodyMedium, fontSize: 10 },
  fieldWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1, borderRadius: radii.md,
    minHeight: 48, paddingHorizontal: space.md },
  fieldWrapDisabled: { backgroundColor: colors.surface1, opacity: 0.6 },
  input: {
    flex: 1,
    color: colors.text, fontFamily: font.body, fontSize: 15,
    paddingVertical: 12 },
  inputDisabled: { color: colors.textSecondary },
  trailing: { marginLeft: 8 },
  helper: {
    color: colors.textTertiary, fontFamily: font.body, fontSize: 11,
    marginTop: 6, lineHeight: 16 },
  errorTxt: {
    color: colors.secondary, fontFamily: font.bodyMedium, fontSize: 11,
    marginTop: 6, lineHeight: 16 } });
