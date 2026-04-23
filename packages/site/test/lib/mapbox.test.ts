import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getMapboxToken', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('retorna null quando a env não está definida', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '');
    const { getMapboxToken } = await import('@/lib/mapbox');
    expect(getMapboxToken()).toBeNull();
  });

  it('retorna null para string só-espaços', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '   ');
    const { getMapboxToken } = await import('@/lib/mapbox');
    expect(getMapboxToken()).toBeNull();
  });

  it('retorna o token quando definido', async () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.testtoken');
    const { getMapboxToken } = await import('@/lib/mapbox');
    expect(getMapboxToken()).toBe('pk.testtoken');
  });
});
