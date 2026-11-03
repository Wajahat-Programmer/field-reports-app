import { PermissionsAndroid } from 'react-native';

export type CameraAccess = 'granted' | 'denied' | 'blocked';

export const hasCameraAccess = (): Promise<boolean> => PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);

/** 'blocked' means Android won't show the prompt again; only the system Settings can grant it now. */
export async function requestCameraAccess(): Promise<CameraAccess> {
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'granted';
  }
  return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}
