import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createServices } from './src/app/services';
import type { Report } from './src/core/types';
import { clearPhotos, deletePhoto } from './src/native/photos';
import { ComposeScreen } from './src/screens/ComposeScreen';
import { HomeScreen } from './src/screens/HomeScreen';

const removePhotos = (reports: Report[]) => Promise.all(reports.flatMap(r => r.images.map(i => deletePhoto(i.uri))));

export default function App() {
  const { runner, api } = useMemo(createServices, []);
  const [screen, setScreen] = useState<'home' | 'compose'>('home');
  const [delivered, setDelivered] = useState(0);

  // Once the server has confirmed a report, the server list is the record; free the phone's copy.
  const settle = useCallback(
    async (report: Report) => {
      await removePhotos([report]);
      await runner.discard(report.id);
      setDelivered(n => n + 1);
    },
    [runner],
  );

  useEffect(() => {
    runner.start().then(async () => {
      for (const report of await runner.list()) {
        if (report.status === 'uploaded') {
          settle(report); // left over if the app died between "uploaded" and cleanup
        }
      }
    });
    const off = runner.subscribe(event => {
      if (event.type === 'report' && event.report.status === 'uploaded') {
        settle(event.report);
      }
    });
    // Coming back to the app skips any backoff wait.
    const appState = AppState.addEventListener('change', next => next === 'active' && runner.resume());
    return () => {
      off();
      appState.remove();
      runner.stop();
    };
  }, [runner, settle]);

  const reset = useCallback(async () => {
    await removePhotos(await runner.reset());
    await clearPhotos();
    await runner.start();
  }, [runner]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {screen === 'compose' ? (
        <ComposeScreen runner={runner} onDone={() => setScreen('home')} onCancel={() => setScreen('home')} />
      ) : (
        <HomeScreen runner={runner} api={api} deliveredCount={delivered} onNew={() => setScreen('compose')} onReset={reset} />
      )}
    </SafeAreaProvider>
  );
}
