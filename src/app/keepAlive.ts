import type { Report } from '../core/types';

/**
 * What the background notification should say, or undefined when nothing is waiting (so the service stops).
 * Like the home screen, it only says "uploading" when the phone really is online.
 */
export function keepAliveText(reports: Report[], online: boolean): string | undefined {
  const waiting = reports.filter(r => r.status === 'queued' || r.status === 'uploading').length;
  if (waiting === 0) {
    return undefined;
  }
  const noun = waiting === 1 ? 'report' : 'reports';
  return online ? `Uploading ${waiting} ${noun}` : `${waiting} ${noun} saved, waiting for a connection`;
}
