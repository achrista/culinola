import type { Datapoint } from '@culinola/sdk';
import { reactive, ref } from 'vue';
import { accessToken } from './api.ts';

/** Aktueller Stand aller abonnierten Datenpunkte, laufend vom Kern aktualisiert. */
export const datapoints = reactive(new Map<string, Datapoint>());
export const connected = ref(false);

const RECONNECT_MS = 3000;
let socket: WebSocket | undefined;
let topics: string[] = [];

/** Legt fest, welche Datenpunkte die Anzeige braucht – nur diese schickt der Kern. */
export function subscribe(ids: readonly string[]): void {
  topics = ids.map((id) => `dp/${id}`);
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
    const message = JSON.parse(event.data as string) as { t: string; d: Datapoint };
    if (message.t.startsWith('dp/')) datapoints.set(message.d.id, message.d);
  });
  socket.addEventListener('close', () => {
    connected.value = false;
    setTimeout(connect, RECONNECT_MS);
  });
}
