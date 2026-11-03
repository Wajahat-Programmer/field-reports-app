import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, TAP } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

export function Button({ label, onPress, kind = 'secondary', disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles[kind], disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={[styles.label, kind === 'primary' && styles.primaryLabel, kind === 'danger' && styles.dangerLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: TAP, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.card, borderColor: colors.line },
  danger: { backgroundColor: colors.card, borderColor: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  label: { fontSize: 16, fontWeight: '600', color: colors.ink },
  primaryLabel: { color: colors.accentInk },
  dangerLabel: { color: colors.danger },
});
