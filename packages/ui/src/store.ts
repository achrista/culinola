import type { Datapoint } from '@culinola/sdk';
import { reactive, ref } from 'vue';
import { currentToken } from './api.ts';

/** Aktueller Stand aller abonnierten Datenpunkte, laufend vom Kern aktualisiert. */
export const datapoints = reactive(new Map<string, Datapoint>());
export const connected = ref(false);

/** Eine Meldung des Kerns, etwa „Jemand klingelt an der Haustür“. */
export interface Raised {
  id: number;
  name: string;
  at: string;
  text: string;
  /** `false`: ein reines Signal für andere Programme – die Anzeige zeigt nichts. */
  show?: boolean;
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

const layoutListeners = new Set<(id: string) => void>();

/** Meldet, wenn der Kern ein Layout geändert hat – oder wenn die Verbindung wiederkommt und es sich geändert haben könnte. */
export function onLayoutChanged(listener: (id: string) => void): () => void {
  layoutListeners.add(listener);
  return () => void layoutListeners.delete(listener);
}

const siteListeners = new Set<(site: unknown) => void>();

/** Meldet, wenn Sprache, Region oder Farbschema im Kern geändert wurden. */
export function onSiteChanged(listener: (site: unknown) => void): () => void {
  siteListeners.add(listener);
  return () => void siteListeners.delete(listener);
}

const RECONNECT_MS = 3000;
let socket: WebSocket | undefined;
let topics: string[] = [];
let layout = '';
let wasConnected = false;

/**
 * Legt fest, welche Datenpunkte die Anzeige braucht – nur diese schickt der Kern.
 * Eine Angabe wie "radio:*" meint alle Datenpunkte einer Quelle.
 */
export function subscribe(ids: readonly string[], shownLayout: string): void {
  layout = shownLayout;
  // Meldungen gehen an jede Anzeige, gleich welche Datenpunkte sie braucht; dazu Änderungen am eigenen Layout
  topics = [...ids.map((id) => `dp/${id}`), 'event/*', `layout/${layout}`];
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'sub', topics }));
}

export function connect(): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = currentToken();
  socket = new WebSocket(`${protocol}//${location.host}/api/v1/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  socket.addEventListener('open', () => {
    connected.value = true;
    socket!.send(JSON.stringify({ op: 'sub', topics }));
    // Nach einer Unterbrechung – etwa einem Neustart des Kerns – kann das Layout ein anderes sein
    if (wasConnected) for (const listener of layoutListeners) listener(layout);
    wasConnected = true;
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data as string) as { t: string; d: unknown };
    if (message.t.startsWith('dp/')) datapoints.set((message.d as Datapoint).id, message.d as Datapoint);
    else if (message.t.startsWith('event/')) for (const listener of eventListeners) listener(message.d as Raised);
    else if (message.t === 'site') for (const listener of siteListeners) listener(message.d);
    else if (message.t.startsWith('layout/')) for (const listener of layoutListeners) listener((message.d as { id: string }).id);
  });
  socket.addEventListener('close', () => {
    connected.value = false;
    setTimeout(connect, RECONNECT_MS);
  });
}
