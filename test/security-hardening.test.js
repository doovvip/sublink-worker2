import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/dropboxOAuth.js', () => ({
  loadStoredDropboxRefreshToken: vi.fn(async () => 'refresh-token')
}));

const { handlePrivateSurgeDelivery } = await import('../src/privateSurgeDelivery.js');

const env = {
  DROPBOX_APP_KEY: 'app-key',
  R2_DELIVERY_TOKEN: 'test-r2-token',
  DROPBOX_R2_PATH: '/r2.conf',
  DROPBOX_TANZOU_PATH: '/tanzou.list'
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => {
    const value = String(url);
    if (value.includes('/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'fresh-access' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (value.includes('/2/files/download')) {
      return new Response('#!MANAGED-CONFIG https://old.invalid/R2.conf interval=86400 strict=false\n[Proxy Group]\n✈️ 我的节点 = select, policy-path=https://old.invalid/TanZou.list\n', { status: 200 });
    }
    throw new Error(`unexpected fetch: ${value}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('private delivery hardening', () => {
  it('retires all remote master routes', async () => {
    const response = await handlePrivateSurgeDelivery(new Request('https://example.com/private/master?token=test-r2-token'), env);
    expect(response.status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not accept the legacy delivery key as R2 authorization', async () => {
    const response = await handlePrivateSurgeDelivery(new Request('https://example.com/private/R2.conf?key=legacy-key'), {
      ...env,
      SURGE_DELIVERY_KEY: 'legacy-key'
    });
    expect(response.status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('serves R2 only with the R2 token and preserves no-store semantics', async () => {
    const response = await handlePrivateSurgeDelivery(new Request('https://example.com/private/R2.conf?token=test-r2-token'), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(body).toContain('/private/R2.conf?token=test-r2-token');
    expect(body).toContain('/private/TanZou.list?token=test-r2-token');
    expect(body).not.toContain('old.invalid');
  });
});
