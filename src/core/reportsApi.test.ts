import { HttpError } from './errors';
import { ReportsApi } from './reportsApi';

const json = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as unknown as Response;

describe('ReportsApi', () => {
  it('lists reports with the api key', async () => {
    const fetchImpl = jest.fn(async () => json({ reports: [{ id: 'a' }] }));
    const api = new ReportsApi({ baseUrl: 'https://x.test', apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await api.list()).toEqual([{ id: 'a' }]);
    expect(fetchImpl).toHaveBeenCalledWith('https://x.test/reports', expect.objectContaining({ headers: { 'x-api-key': 'k' } }));
  });

  it('throws HttpError on a failed response', async () => {
    const api = new ReportsApi({ baseUrl: 'https://x.test', apiKey: 'k', fetchImpl: (async () => json({}, 503)) as unknown as typeof fetch });
    await expect(api.list()).rejects.toBeInstanceOf(HttpError);
  });

  it('builds an authorised image source', () => {
    const api = new ReportsApi({ baseUrl: 'https://x.test', apiKey: 'k' });
    expect(api.imageSource('/reports/a/images/0')).toEqual({
      uri: 'https://x.test/reports/a/images/0',
      headers: { 'x-api-key': 'k' },
    });
  });
});
