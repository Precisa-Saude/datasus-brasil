import type maplibregl from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';

import type { BinTotals } from '@/lib/data-cube';
import { pushUfState } from '@/lib/map-layers';

interface FeatureKey {
  id: number | string;
  source: string;
  sourceLayer: string;
}

function fakeMap(): {
  map: maplibregl.Map;
  states: Map<number | string, Record<string, unknown>>;
} {
  const states = new Map<number | string, Record<string, unknown>>();
  const map = {
    removeFeatureState: vi.fn(),
    setFeatureState: vi.fn((key: FeatureKey, state: Record<string, unknown>) => {
      states.set(key.id, state);
    }),
  } as unknown as maplibregl.Map;
  return { map, states };
}

function totals(volume: number, valor = volume * 10): BinTotals {
  return { bin: 'X', label: 'X', valor, volume };
}

describe('pushUfState', () => {
  it('aplica escala sqrt: SP no topo (~1), meio do ranking acima do que daria linear', () => {
    const { map, states } = fakeMap();
    const byUf = new Map<string, BinTotals>([
      ['SP', totals(300_000_000)],
      ['MG', totals(80_000_000)],
      ['RR', totals(1_000_000)],
    ]);

    pushUfState(map, byUf);

    const sp = states.get('SP') as { normalizado: number; rank: number };
    const mg = states.get('MG') as { normalizado: number };
    const rr = states.get('RR') as { normalizado: number };

    expect(sp.normalizado).toBeCloseTo(1, 5);
    // Linear seria MG = 80M / 300M ≈ 0.27 (faixa pálida). Sqrt sobe
    // pra ~0.516 (faixa média do ramp) sem ir pro extremo escuro
    // que log produzia (~0.93).
    expect(mg.normalizado).toBeCloseTo(Math.sqrt(80 / 300), 5);
    expect(mg.normalizado).toBeGreaterThan(0.4);
    expect(mg.normalizado).toBeLessThan(0.7);
    expect(rr.normalizado).toBeGreaterThan(0);
    expect(rr.normalizado).toBeLessThan(mg.normalizado);
  });

  it('persiste rank competition-style + rankTotal no feature state', () => {
    const { map, states } = fakeMap();
    const byUf = new Map<string, BinTotals>([
      ['SP', totals(300)],
      ['MG', totals(80)],
      ['RJ', totals(80)], // empate com MG
      ['RR', totals(1)],
    ]);

    pushUfState(map, byUf);

    expect((states.get('SP') as { rank: number }).rank).toBe(1);
    expect((states.get('MG') as { rank: number }).rank).toBe(2);
    expect((states.get('RJ') as { rank: number }).rank).toBe(2);
    // Empate em 2/2 → próxima posição pula pra 4 (competition rank).
    expect((states.get('RR') as { rank: number }).rank).toBe(4);
    expect((states.get('SP') as { rankTotal: number }).rankTotal).toBe(4);
  });

  it('lida com byUf vazio sem explodir', () => {
    const { map } = fakeMap();
    expect(() => pushUfState(map, new Map())).not.toThrow();
  });
});
