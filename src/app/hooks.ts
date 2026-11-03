import { useCallback, useEffect, useRef, useState } from 'react';

import type { ReportsApi, ServerReport } from '../core/reportsApi';
import type { ListCache } from './listCache';
import type { RunnerState, UploadRunner } from '../core/runner';
import type { Report } from '../core/types';

export interface Progress {
  index: number;
  sentBytes: number;
  totalBytes: number;
}

const byCreated = (a: Report, b: Report) => a.createdAt - b.createdAt;

/** Mirrors the runner's reports, state and per-report upload progress into React state. */
export function useRunner(runner: UploadRunner) {
  const [reports, setReports] = useState<Report[]>([]);
  const [state, setState] = useState<RunnerState>(runner.getState());
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  useEffect(() => {
    let alive = true;
    runner.list().then(list => alive && setReports(list.sort(byCreated)));
    const off = runner.subscribe(event => {
      if (event.type === 'report') {
        setReports(prev => [...prev.filter(r => r.id !== event.report.id), event.report].sort(byCreated));
      } else if (event.type === 'removed') {
        setReports(prev => prev.filter(r => r.id !== event.id));
      } else if (event.type === 'runner') {
        setState(event.state);
      } else {
        setProgress(prev => ({ ...prev, [event.id]: event }));
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [runner]);

  return { reports, state, progress };
}

/** Re-renders every second so retry countdowns tick. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface ServerList {
  status: 'loading' | 'ok' | 'error';
  reports: ServerReport[];
}

/**
 * What the server holds, fetched from it. If a refresh fails, the last list we got stays on screen,
 * even across a restart, so being offline never makes delivered reports look lost.
 */
export function useServerReports(api: ReportsApi, cache: ListCache) {
  const [list, setList] = useState<ServerList>({ status: 'loading', reports: [] });
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const reports = await api.list();
      if (ticket === latest.current) {
        setList({ status: 'ok', reports });
        cache.save(reports).catch(() => {});
      }
    } catch {
      if (ticket === latest.current) {
        setList(prev => ({ status: 'error', reports: prev.reports }));
      }
    }
  }, [api, cache]);

  useEffect(() => {
    let alive = true;
    cache.load().then(cached => {
      if (alive && cached) {
        setList(prev => (prev.status === 'ok' || prev.reports.length ? prev : { status: prev.status, reports: cached }));
      }
    });
    refresh();
    return () => {
      alive = false;
    };
  }, [api, cache, refresh]);

  return { list, refresh };
}
