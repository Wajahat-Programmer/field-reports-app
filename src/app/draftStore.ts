import type { AsyncStorage } from '@react-native-async-storage/async-storage';

import type { ImageFile } from '../core/types';

const KEY = 'draft';

/** A report being composed but not saved yet. Photos in it are already prepared and stored on the phone. */
export interface Draft {
  description: string;
  images: ImageFile[];
}

export interface DraftStore {
  load(): Promise<Draft | undefined>;
  save(draft: Draft): Promise<void>;
  clear(): Promise<void>;
}

export function createDraftStore(storage: AsyncStorage): DraftStore {
  return {
    async load() {
      try {
        const raw = await storage.getItem(KEY);
        const parsed = raw ? JSON.parse(raw) : undefined;
        if (typeof parsed?.description === 'string' && Array.isArray(parsed.images)) {
          return parsed;
        }
      } catch {
        // an unreadable draft is just no draft
      }
      return undefined;
    },
    // An empty draft is no draft, so nothing is left behind after a blank screen.
    save: draft => (draft.description.trim() || draft.images.length ? storage.setItem(KEY, JSON.stringify(draft)) : storage.removeItem(KEY)),
    clear: () => storage.removeItem(KEY),
  };
}
