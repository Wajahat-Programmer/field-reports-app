import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createServices } from './src/app/services';
import type { Report } from './src/core/types';
import { keepAliveText } from './src/app/keepAlive';
import { clearChunkTemps } from './src/native/blobUploader';
import { askForNotificationsOnce, showKeepAlive, stopKeepAlive } from './src/native/keepAlive';
import { clearPhotos, deletePhoto, sweepPhotos } from './src/native/photos';
import { ComposeScreen } from './src/screens/ComposeScreen';
import { HomeScreen } from './src/screens/HomeScreen';

const removePhotos = (reports: Report[]) => Promise.all(reports.flatMap(r => r.images.map(i => deletePhoto(i.uri))));

export default function App() {
  const { runner, api, storage, listCache, draftStore } = useMemo(createServices, []);
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
    // Housekeeping runs before the runner starts, so it can't delete a file an upload is using.
    const boot = async () => {
      await clearChunkTemps();
      const [reports, draft] = await Promise.all([runner.list(), draftStore.load()]);
      // Photos prepared for a draft that was never finished or saved belong to nothing: delete them.
      await sweepPhotos([...reports.flatMap(r => r.images), ...(draft?.images ?? [])].map(i => i.uri));
      await runner.start();
      for (const report of await runner.list()) {
        if (report.status === 'uploaded') {
          settle(report); // left over if the app died between "uploaded" and cleanup
        }
      }
    };
    boot();
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
  }, [runner, settle, draftStore]);

  // While reports are waiting, hold a foreground notification so Android keeps the app alive in the background.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      const text = keepAliveText(await runner.list(), runner.getState().online);
      if (text) {
        showKeepAlive(text);
      } else {
        stopKeepAlive();
      }
    };
    const off = runner.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(sync, 400);
    });
    sync();
    return () => {
      off();
      clearTimeout(timer);
      stopKeepAlive();
    };
  }, [runner]);

  const reset = useCallback(async () => {
    await removePhotos(await runner.reset());
    await clearPhotos();
    await clearChunkTemps();
    await draftStore.clear();
    await runner.start();
  }, [runner, draftStore]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {screen === 'compose' ? (
        <ComposeScreen runner={runner} draftStore={draftStore} onDone={() => {
            setScreen('home');
            askForNotificationsOnce(storage);
          }} onCancel={() => setScreen('home')} />
      ) : (
        <HomeScreen runner={runner} api={api} listCache={listCache} draftStore={draftStore} deliveredCount={delivered} onNew={() => setScreen('compose')} onReset={reset} />
      )}
    </SafeAreaProvider>
  );
}
