import { describe, expect, it } from 'vitest';
import { shownDatapoints } from './shown.ts';

describe('Was die Anzeigen zeigen', () => {
  it('nimmt die Beschriftung der Kachel als Namen des Datenpunkts', () => {
    const shown = shownDatapoints({
      main: {
        grid: { columns: 4, rows: 2 },
        widgets: [
          { type: 'clock', at: [0, 0, 1, 1] },
          {
            type: 'value-tile',
            at: [0, 0, 1, 1],
            config: {
              datapoint: 'oh:T_Aussen',
              label: ' Außen ',
              secondary: 'oh:F_Aussen',
              fresh: 'oh:Frisch',
            },
          },
          {
            type: 'switches',
            at: [0, 0, 1, 1],
            config: {
              items: [{ datapoint: 'oh:Licht', label: 'Esstisch' }, { datapoint: 'oh:Ohne' }],
            },
          },
          {
            type: 'presence',
            at: [0, 0, 1, 1],
            config: {
              title: 'Wer ist da',
              people: [{ name: 'Uli', datapoint: 'oh:mobUli' }],
            },
          },
          {
            type: 'image',
            at: [0, 0, 1, 1],
            config: { url: 'https://example.org/bild.jpg', label: 'Stadt' },
          },
        ],
      },
      zweites: {
        grid: { columns: 4, rows: 2 },
        widgets: [
          // Dieselben Datenpunkte noch einmal: Die erste Beschriftung gilt, ein fehlender Name wird nachgetragen
          {
            type: 'value-tile',
            at: [0, 0, 1, 1],
            config: { datapoint: 'oh:T_Aussen', label: 'Draußen' },
          },
          {
            type: 'chart',
            at: [0, 0, 1, 1],
            config: {
              title: 'Luft',
              series: [{ datapoint: 'oh:F_Aussen', label: 'Feuchte außen' }],
            },
          },
        ],
      },
    });
    expect(shown).toEqual([
      { id: 'oh:T_Aussen', name: 'Außen' },
      { id: 'oh:F_Aussen', name: 'Feuchte außen' },
      { id: 'oh:Frisch', name: '' },
      { id: 'oh:Licht', name: 'Esstisch' },
      { id: 'oh:Ohne', name: '' },
      { id: 'oh:mobUli', name: 'Uli' },
    ]);
    expect(shownDatapoints({})).toEqual([]);
  });
});
