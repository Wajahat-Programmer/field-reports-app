import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { AsyncStorage } from '@react-native-async-storage/async-storage';

interface UploadKeepAliveModule {
  show(text: string): void;
  stop(): void;
}

// Absent in tests and on platforms without the Android service; then these calls do nothing.
const native: UploadKeepAliveModule | undefined = NativeModules.UploadKeepAlive;

let release: (() => void) | undefined;

/**
 * The headless task the service runs. React Native only keeps its timers alive in the background while a task
 * is pending, and the runner's stall watchdog and retry delays are timers, so this promise stays open until
 * stopKeepAlive().
 */
export const keepAliveTask = () => new Promise<void>(resolve => {
  release = resolve;
});

/** Starts (or updates) the foreground notification that keeps Android from pausing uploads in the background. */
export const showKeepAlive = (text: string) => native?.show(text);
export const stopKeepAlive = () => {
  native?.stop();
  release?.();
  release = undefined;
};

/**
 * Android 13+ needs permission to show the notification. Ask once, after the first report is saved, when the
 * reason is obvious. A refusal costs nothing: the service still runs, the notification is just hidden.
 */
export async function askForNotificationsOnce(storage: AsyncStorage): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return;
  }
  if (await storage.getItem('asked-notifications')) {
    return;
  }
  await storage.setItem('asked-notifications', '1');
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (!(await PermissionsAndroid.check(permission))) {
    await PermissionsAndroid.request(permission).catch(() => {});
  }
}
