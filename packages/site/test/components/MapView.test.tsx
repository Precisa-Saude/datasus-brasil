import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MapView } from '@/components/MapView';

vi.mock('@/lib/mapbox', () => ({
  BRAZIL_CENTER: [-52, -14] as [number, number],
  BRAZIL_ZOOM: 3.4,
  getMapboxToken: () => null,
}));

describe('MapView', () => {
  it('renderiza mensagem de token ausente quando VITE_MAPBOX_TOKEN não está definido', () => {
    render(
      <MapView
        competencia="2024-01"
        data={[]}
        geoUF={{ features: [], type: 'FeatureCollection' }}
        loinc="4548-4"
      />,
    );
    expect(screen.getByText(/Token do Mapbox não configurado/i)).toBeInTheDocument();
    expect(screen.getByText(/VITE_MAPBOX_TOKEN/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /account\.mapbox\.com/i })).toBeInTheDocument();
  });
});
