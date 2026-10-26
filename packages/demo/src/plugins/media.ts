import type { PluginContext, PluginDefinition } from '@culinola/sdk';
import { icyFilter } from '../../../../plugins/media-radio/src/icy.ts';

/** Kameras der Demo: aufgezeichnete Clips, die in Schleife laufen, an Stelle von go2rtc. */
export function startVideo(context: PluginContext<unknown>, clips: Record<string, string>): void {
  const streams = ((context.config as { streams?: { id: string; name: string }[] }).streams ?? []).filter((stream) => clips[stream.id]);
  context.resources.set(
    'streams',
    streams.map((stream) => ({ id: stream.id, name: stream.name, mode: 'file', url: clips[stream.id] })),
  );
  context.log.info(`${streams.length} Kameras eingerichtet.`);
}

const TITLE_EVERY_MS = 30_000;

/**
 * Das echte Radio-Plugin, dazu der laufende Titel: Ohne Kern im Netz holt der Browser den Ton direkt beim Sender.
 * Für den Titel liest die Demo in Abständen den Anfang des Stroms, bis der eingebettete Titel kommt, und bricht dann ab.
 */
export function withTitles(radio: PluginDefinition<unknown>): PluginDefinition<unknown> {
  return {
    ...radio,
    async start(context) {
      await radio.start?.(context);
      const stations = (context.config as { stations: { id: string; url?: string; kind: string }[] }).stations;
      const station = () => {
        const id = context.datapoints.list().find((datapoint) => datapoint.id === `${context.instanceId}:station`)?.value;
        return stations.find((entry) => entry.id === id && entry.kind === 'audio' && entry.url);
      };
      // Manche Sender erlauben das Mitlesen nicht oder betten keinen Titel ein – bei ihnen bleibt es bei einem Versuch
      const silent = new Set<string>();
      const read = async () => {
        const playing = station();
        if (!playing || silent.has(playing.id) || document.hidden) return;
        silent.add(playing.id);
        const stop = new AbortController();
        const timeout = setTimeout(() => stop.abort(), 10_000);
        try {
          const response = await fetch(playing.url!, { headers: { 'Icy-MetaData': '1' }, signal: AbortSignal.any([stop.signal, context.signal]) });
          const interval = Number(response.headers.get('icy-metaint')) || 0;
          if (!interval || !response.body) return void (await response.body?.cancel());
          const reader = response.body
            .pipeThrough(
              icyFilter(interval, (title) => {
                silent.delete(playing.id);
                if (station()?.id === playing.id) context.datapoints.set({ id: 'title', value: title, label: 'Laufender Titel' });
                stop.abort();
              }),
            )
            .getReader();
          while (!(await reader.read()).done);
        } catch {
          // Ohne Titel spielt das Radio trotzdem.
        } finally {
          clearTimeout(timeout);
        }
      };
      let last = '';
      const check = () => {
        const id = station()?.id ?? '';
        if (id !== last) {
          last = id;
          void read();
        }
      };
      const changes = setInterval(check, 1000);
      const titles = setInterval(() => void read(), TITLE_EVERY_MS);
      context.signal.addEventListener('abort', () => {
        clearInterval(changes);
        clearInterval(titles);
      });
    },
  };
}
