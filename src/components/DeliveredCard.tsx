import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ReportsApi, ServerReport } from '../core/reportsApi';
import { colors } from '../theme';

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** A report the server confirmed it holds. */
export function DeliveredCard({ report, api }: { report: ServerReport; api: ReportsApi }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{report.description}</Text>
      <Text style={styles.meta}>
        Delivered {when(report.completedAt)} · {report.images.length} {report.images.length === 1 ? 'photo' : 'photos'}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
        {report.images.map(image => (
          <Image
            key={image.index}
            source={api.imageSource(image.url)}
            style={styles.photo}
            accessibilityLabel={`Photo ${image.index + 1} of ${report.images.length}`}
            accessibilityIgnoresInvertColors
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 6 },
  title: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.inkSoft },
  photos: { gap: 8, paddingTop: 6 },
  photo: { width: 96, height: 96, borderRadius: 8, backgroundColor: colors.line },
});
