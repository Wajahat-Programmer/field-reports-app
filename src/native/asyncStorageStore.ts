import type { AsyncStorage } from '@react-native-async-storage/async-storage';

import type { ReportStore } from '../core/ports';
import type { Report } from '../core/types';

const PREFIX = 'report:';

/** One storage key per report, so a write only touches that report and can't corrupt the others. */
export class AsyncStorageReportStore implements ReportStore {
  constructor(private readonly storage: AsyncStorage) {}

  save(report: Report): Promise<void> {
    return this.storage.setItem(PREFIX + report.id, JSON.stringify(report));
  }

  async get(id: string): Promise<Report | undefined> {
    const raw = await this.storage.getItem(PREFIX + id);
    return raw ? JSON.parse(raw) : undefined;
  }

  async list(): Promise<Report[]> {
    const keys = (await this.storage.getAllKeys()).filter(key => key.startsWith(PREFIX));
    const entries = await this.storage.getMany(keys);
    return Object.values(entries)
      .filter((raw): raw is string => raw !== null)
      .map(raw => JSON.parse(raw));
  }

  remove(id: string): Promise<void> {
    return this.storage.removeItem(PREFIX + id);
  }
}
