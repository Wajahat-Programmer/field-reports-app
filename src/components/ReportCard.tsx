import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Progress } from '../app/hooks';
import { retryInSeconds } from '../app/status';
import type { Report } from '../core/types';
import { colors } from '../theme';
import { Button } from './Button';

interface Props {
  report: Report;
  online: boolean;
  now: number;
  progress?: Progress;
  onRetry: () => void;
  onDelete: () => void;
}

const photos = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;

/** A report that exists only on this phone so far. Always says where it stands. */
export function ReportCard({ report, online, now, progress, onRetry, onDelete }: Props) {
  const total = report.images.length;
  const done = report.uploadedImages.length;
  const current = progress && report.status === 'uploading' ? progress.sentBytes / Math.max(progress.totalBytes, 1) : 0;
  const fraction = Math.min(1, (done + current) / total);
  const retry = retryInSeconds(report, now);

  let line: string;
  if (report.status === 'uploading') {
    line = `Uploading photo ${Math.min(done + 1, total)} of ${total}`;
  } else if (report.status === 'failed') {
    line = `Rejected by the server (${report.lastError ?? 'unknown reason'}). Still saved on this phone.`;
  } else if (!online) {
    line = 'Saved on this phone. Waiting for a connection.';
  } else if (retry !== undefined) {
    line = `Saved on this phone. Trying again in ${retry}s.`;
  } else {
    line = 'Saved on this phone. Uploading shortly.';
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Image source={{ uri: report.images[0].uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {report.description}
          </Text>
          <Text style={styles.meta}>{photos(total)}</Text>
          <Text style={[styles.status, report.status === 'failed' && styles.statusBad]}>{line}</Text>
        </View>
      </View>

      {report.status === 'uploading' ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
          style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
      ) : null}

      {report.status !== 'uploading' ? (
        <View style={styles.actions}>
          {report.status === 'failed' ? <Button label="Try again" onPress={onRetry} /> : null}
          {report.status === 'queued' && report.attempts > 0 && online ? <Button label="Retry now" onPress={onRetry} /> : null}
          <Button label="Delete" kind="danger" onPress={onDelete} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.line },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 13, color: colors.inkSoft },
  status: { fontSize: 14, color: colors.inkSoft, marginTop: 2 },
  statusBad: { color: colors.danger },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.accent },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
