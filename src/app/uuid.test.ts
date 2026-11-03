import { newId } from './uuid';

// The same pattern the backend validates ids against.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('newId', () => {
  it('makes valid, distinct UUIDs', () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    ids.forEach(id => expect(id).toMatch(UUID));
  });

  it('still works when crypto.randomUUID is missing', () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    (globalThis as { crypto?: unknown }).crypto = undefined;
    try {
      expect(newId()).toMatch(UUID);
    } finally {
      (globalThis as { crypto?: unknown }).crypto = original;
    }
  });
});
