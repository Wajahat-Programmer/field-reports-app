import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Summary } from '../app/status';
import { toneColors } from '../theme';

export function StatusBanner({ summary }: { summary: Summary }) {
  const tone = toneColors[summary.tone];
  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={[styles.box, { backgroundColor: tone.bg, borderLeftColor: tone.edge }]}>
      <Text style={[styles.title, { color: tone.fg }]}>{summary.title}</Text>
      {summary.detail ? <Text style={[styles.detail, { color: tone.fg }]}>{summary.detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderLeftWidth: 5, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 14 },
  title: { fontSize: 16, fontWeight: '700' },
  detail: { fontSize: 14, marginTop: 2 },
});
