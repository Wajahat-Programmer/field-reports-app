import type { RunnerState } from '../core/runner';
import type { Report } from '../core/types';

export type Tone = 'ok' | 'busy' | 'warn' | 'error';

export interface Summary {
  tone: Tone;
  title: string;
  detail?: string;
}

const reports = (n: number) => `${n} ${n === 1 ? 'report' : 'reports'}`;

/**
 * The one-glance answer to "is my work safe?". The wording keeps two facts apart:
 * "saved on this phone" (not on the server yet) and "delivered" (confirmed by the server).
 */
export function summarize(items: Report[], state: RunnerState): Summary {
  const failed = items.filter(r => r.status === 'failed');
  const uploading = items.filter(r => r.status === 'uploading');
  const waiting = items.filter(r => r.status === 'queued');
  const notDelivered = failed.length + uploading.length + waiting.length;

  if (state.authBlocked) {
    return {
      tone: 'error',
      title: "Can't sign in to the server",
      detail: notDelivered
        ? `${reports(notDelivered)} saved on this phone. This build has a wrong or expired key.`
        : 'This build has a wrong or expired key.',
    };
  }
  if (failed.length) {
    return {
      tone: 'error',
      title: `${reports(failed.length)} rejected by the server`,
      detail: 'Still saved on this phone. Open it to try again or delete it.',
    };
  }
  if (waiting.length + uploading.length > 0 && !state.online) {
    return {
      tone: 'warn',
      title: `Offline: ${reports(notDelivered)} saved on this phone`,
      detail: 'They upload by themselves when the connection is back.',
    };
  }
  if (uploading.length) {
    return { tone: 'busy', title: `Uploading ${reports(notDelivered)}`, detail: 'Keep going, this runs in the background.' };
  }
  if (waiting.length) {
    const retrying = waiting.some(r => r.attempts > 0);
    return {
      tone: 'warn',
      title: `${reports(waiting.length)} saved on this phone, not uploaded yet`,
      detail: retrying ? 'The connection is poor. Retrying automatically.' : 'Starting shortly.',
    };
  }
  return { tone: 'ok', title: 'Nothing waiting', detail: 'Everything you saved has been delivered.' };
}

/** Seconds until the next automatic retry, or undefined when none is scheduled. */
export function retryInSeconds(report: Report, now: number): number | undefined {
  if (report.status !== 'queued' || report.nextAttemptAt <= now) {
    return undefined;
  }
  return Math.ceil((report.nextAttemptAt - now) / 1000);
}
