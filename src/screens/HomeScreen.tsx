import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ListCache } from '../app/listCache';
import { useNow, useRunner, useServerReports } from '../app/hooks';
import { summarize } from '../app/status';
import type { ReportsApi } from '../core/reportsApi';
import type { UploadRunner } from '../core/runner';
import { Button } from '../components/Button';
import { DeliveredCard } from '../components/DeliveredCard';
import { ReportCard } from '../components/ReportCard';
import { StatusBanner } from '../components/StatusBanner';
import { colors } from '../theme';

interface Props {
  runner: UploadRunner;
  api: ReportsApi;
  listCache: ListCache;
  /** Bumps whenever a report is confirmed delivered, so the server list refreshes. */
  deliveredCount: number;
  onNew: () => void;
  onReset: () => Promise<void>;
}

export function HomeScreen({ runner, api, listCache, deliveredCount, onNew, onReset }: Props) {
  const insets = useSafeAreaInsets();
  const { reports, state, progress } = useRunner(runner);
  const { list, refresh } = useServerReports(api, listCache);
  const now = useNow();

  useEffect(() => {
    if (deliveredCount > 0) {
      refresh();
    }
  }, [deliveredCount, refresh]);

  const wasOnline = useRef(state.online);
  useEffect(() => {
    if (state.online && !wasOnline.current) {
      refresh();
    }
    wasOnline.current = state.online;
  }, [state.online, refresh]);

  const summary = summarize(reports, state);
  const onPhone = [...reports].reverse().filter(r => r.status !== 'uploaded');

  const confirmDelete = (id: string) =>
    Alert.alert('Delete this report?', 'It has not been delivered. It will be removed from this phone for good.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => runner.discard(id).catch(() => {}) },
    ]);

  const confirmReset = () =>
    Alert.alert(
      'Start over?',
      onPhone.length
        ? `This deletes ${onPhone.length} ${onPhone.length === 1 ? 'report' : 'reports'} that ${
            onPhone.length === 1 ? 'has' : 'have'
          } not been delivered, with their photos, from this phone. Reports already delivered stay on the server.`
        : 'Nothing on this phone is waiting. Reports already delivered stay on the server.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start over', style: 'destructive', onPress: () => onReset() },
      ],
    );

  return (
    <SectionList
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Field reports
          </Text>
          <StatusBanner summary={summary} />
          <Button label="New report" kind="primary" onPress={onNew} />
        </View>
      }
      sections={[
        { key: 'phone', title: 'On this phone', data: onPhone as unknown[] },
        { key: 'server', title: 'Delivered', data: list.reports as unknown[] },
      ]}
      keyExtractor={(item: unknown) => (item as { id: string }).id}
      renderSectionHeader={({ section }) => (
        <Text style={styles.section} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      renderItem={({ item, section }) =>
        section.key === 'phone' ? (
          <ReportCard
            report={item as (typeof reports)[number]}
            online={state.online}
            now={now}
            progress={progress[(item as { id: string }).id]}
            onRetry={() => (item as { status: string }).status === 'failed' ? runner.retry((item as { id: string }).id) : runner.resume()}
            onDelete={() => confirmDelete((item as { id: string }).id)}
          />
        ) : (
          <DeliveredCard report={item as (typeof list.reports)[number]} api={api} />
        )
      }
      ItemSeparatorComponent={() => <View style={styles.gap} />}
      renderSectionFooter={({ section }) =>
        section.data.length === 0 ? (
          <View style={styles.empty}>
            {section.key === 'server' && list.status === 'loading' ? <ActivityIndicator /> : null}
            <Text style={styles.emptyText}>
              {section.key === 'phone'
                ? 'Nothing waiting. New reports you save appear here until the server confirms them.'
                : list.status === 'error'
                  ? "Couldn't load delivered reports. Pull down to try again."
                  : list.status === 'loading'
                    ? 'Loading…'
                    : 'No delivered reports yet.'}
            </Text>
          </View>
        ) : section.key === 'server' && list.status === 'error' ? (
          <Text style={styles.emptyText}>Couldn't refresh. Showing the last list we loaded.</Text>
        ) : null
      }
      ListFooterComponent={
        <View style={styles.footer}>
          <Button label="Start over" kind="danger" onPress={confirmReset} />
          <Text style={styles.footnote}>Deletes everything not yet delivered from this phone. Delivered reports stay on the server.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16 },
  header: { gap: 12, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink },
  section: { fontSize: 14, fontWeight: '700', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },
  gap: { height: 10 },
  empty: { paddingVertical: 8, gap: 8 },
  emptyText: { fontSize: 14, color: colors.inkSoft },
  footer: { marginTop: 28, gap: 8 },
  footnote: { fontSize: 12, color: colors.inkSoft, textAlign: 'center' },
});
