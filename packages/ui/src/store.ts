import type { Datapoint } from '@culinola/sdk';
import { reactive, ref } from 'vue';
import { accessToken } from './api.ts';

/** Aktueller Stand aller abonnierten Datenpunkte, laufend vom Kern aktualisiert. */
export const datapoints = reactive(new Map<string, Datapoint>());
export const connected = ref(false);

/** Eine Meldung des Kerns, etwa „Jemand klingelt an der Haustür“. */
export interface Raised {
  id: number;
  name: string;
  at: string;
  text: string;
  sound: 'bell' | 'chime' | 'beep' | 'none';
  speak: boolean;
  seconds: number;
  video?: { source: string; stream: string };
}
const eventListeners = new Set<(raised: Raised) => void>();

/** Meldet jede Meldung, die der Kern auslöst; der Rückgabewert beendet das. */
export function onEvent(listener: (raised: Raised) => void): () => void {
  eventListeners.add(listener);
  return () => void eventListeners.delete(listener);
}

const RECONNECT_MS = 3000;
let socket: WebSocket | undefined;
let topics: string[] = [];

/**
 * Legt fest, welche Datenpunkte die Anzeige braucht – nur diese schickt der Kern.
 * Eine Angabe wie "radio:*" meint alle Datenpunkte einer Quelle.
 */
export function subscribe(ids: readonly string[]): void {
  // Meldungen gehen an jede Anzeige, gleich welche Datenpunkte sie braucht
  topics = [...ids.map((id) => `dp/${id}`), 'event/*'];
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'sub', topics }));
}

export function connect(): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = accessToken();
  socket = new WebSocket(`${protocol}//${location.host}/api/v1/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  socket.addEventListener('open', () => {
    connected.value = true;
    socket!.send(JSON.stringify({ op: 'sub', topics }));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data as string) as { t: string; d: unknown };
    if (message.t.startsWith('dp/')) datapoints.set((message.d as Datapoint).id, message.d as Datapoint);
    else if (message.t.startsWith('event/')) for (const listener of eventListeners) listener(message.d as Raised);
  });
  socket.addEventListener('close', () => {
    connected.value = false;
    setTimeout(connect, RECONNECT_MS);
  });
}
