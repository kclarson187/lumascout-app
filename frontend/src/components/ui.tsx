import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, TextInputProps } from 'react-native';
import { colors, font, radii, space } from '../theme';

export function Chip({
  label,
  active,
  onPress,
  testID }: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[
        styles.chip,
        active && { backgroundColor: colors.primary, borderColor: colors.primary },
      ]}
      activeOpacity={0.8}
    >
      <Text style={[styles.chipText, active && { color: colors.textInverse }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Input({
  label,
  error,
  testID,
  ...props
}: { label?: string; error?: string; testID?: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        {...props}
        testID={testID}
        placeholderTextColor={colors.textTertiary}
        style={[styles.input, props.style, error && { borderColor: colors.secondary }]}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export function EmptyState({
  title,
  subtitle,
  action,
  icon }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {icon && <View style={styles.emptyIcon}>{icon}</View>}
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle && <Text style={styles.emptySub}>{subtitle}</Text>}
      {action && <View style={{ marginTop: space.lg }}>{action}</View>}
    </View>
  );
}

export function SectionHeader({
  title,
  action,
  onAction }: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && (
        <TouchableOpacity onPress={onAction}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontFamily: font.bodyMedium },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: font.bodyMedium },
  input: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
    fontFamily: font.body },
  error: {
    color: colors.secondary,
    fontSize: 12,
    fontFamily: font.body },
  empty: {
    alignItems: 'center',
    paddingVertical: space.xxxl,
    paddingHorizontal: space.xl },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.md },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontFamily: font.display,
    marginBottom: 6,
    textAlign: 'center' },
  emptySub: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: font.body,
    textAlign: 'center',
    lineHeight: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: space.xl,
    marginTop: space.xl,
    marginBottom: space.md },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontFamily: font.display,
    letterSpacing: -0.3 },
  sectionAction: {
    color: colors.primary,
    fontSize: 13,
    fontFamily: font.bodyMedium } });
