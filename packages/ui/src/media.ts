import { reactive, ref, watch } from 'vue';
import { currentToken, getJson } from './api.ts';
import { datapoints } from './store.ts';

export interface Station {
  id: string;
  name: string;
  kind: 'audio' | 'video';
  image?: string;
}

/** Senderlisten je Radio-Instanz, einmal geladen und von allen Widgets geteilt. */
const lists = reactive(new Map<string, Station[]>());
const loading = new Set<string>();

export function stationsOf(source: string): Station[] {
  if (!lists.has(source) && !loading.has(source)) {
    loading.add(source);
    getJson<Station[]>(`/resources/${encodeURIComponent(source)}/stations`)
      .then((stations) => lists.set(source, stations))
      .catch(() => lists.set(source, []))
      .finally(() => loading.delete(source));
  }
  return lists.get(source) ?? [];
}

/** Der gerade laufende Sender einer Instanz, oder nichts. */
export function currentStation(source: string): Station | undefined {
  const id = datapoints.get(`${source}:station`)?.value;
  return typeof id === 'string' && id ? stationsOf(source).find((station) => station.id === id) : undefined;
}

let resolver: ((path: string) => string | undefined) | undefined;

/**
 * Legt fest, woher Ton- und Bildelemente laden, statt vom Kern – für die Demo im Browser, die keinen Kern im
 * Netz hat. Was der Auflöser nicht kennt (`undefined`), geht weiter an den Kern.
 */
export function resolveMediaWith(resolve: (path: string) => string | undefined): void {
  resolver = resolve;
}

/** Hängt das Zugangstoken an eine Adresse, die ein Ton- oder Bildelement des Browsers lädt. */
export function mediaUrl(path: string): string {
  const resolved = resolver?.(path);
  if (resolved !== undefined) return resolved;
  const token = currentToken();
  return `/api/v1${path}${token ? `${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : ''}`;
}

/** true, wenn der Browser den Ton erst nach einem Antippen starten lässt. */
export const playbackBlocked = ref(false);

const started = new Set<string>();
let audio: HTMLAudioElement | undefined;
let context: AudioContext | undefined;
let gain: GainNode | undefined;

/**
 * Spielt den laufenden Radiosender einer Instanz auf dieser Anzeige ab. Der Ton läuft
 * durch einen Verstärker, damit sich die Lautstärke auch über 100 % stellen lässt.
 */
export function startRadioPlayback(source: string): void {
  if (started.has(source)) return;
  started.add(source);

  const apply = () => {
    const station = currentStation(source);
    const level = datapoints.get(`${source}:volume`)?.value;
    if (gain && typeof level === 'number') gain.gain.value = level / 100;

    if (!station || station.kind !== 'audio') {
      if (audio?.dataset.station) {
        // Nicht nur anhalten: Die Quelle lösen, damit die Verbindung zum Sender wirklich endet.
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        delete audio.dataset.station;
      }
      return;
    }
    if (audio?.dataset.station === station.id) return;

    audio ??= new Audio();
    if (!context) {
      context = new AudioContext();
      gain = context.createGain();
      context.createMediaElementSource(audio).connect(gain).connect(context.destination);
      if (typeof level === 'number') gain.gain.value = level / 100;
    }
    audio.dataset.station = station.id;
    const src = mediaUrl(`/p/${encodeURIComponent(source)}/stream/${encodeURIComponent(station.id)}`);
    // Ton von einem fremden Server läuft nur mit dessen Erlaubnis (CORS) durch den Verstärker – ohne sie bliebe er stumm
    if (new URL(src, location.href).origin !== location.origin) audio.crossOrigin = 'anonymous';
    else audio.removeAttribute('crossorigin');
    audio.src = src;
    void context.resume();
    audio.play().then(
      () => (playbackBlocked.value = false),
      (error: unknown) => {
        // Ohne vorheriges Antippen verweigern Browser den Start; ein Tipp auf die Anzeige holt ihn nach.
        if (error instanceof DOMException && error.name === 'NotAllowedError') playbackBlocked.value = true;
      },
    );
  };

  watch(() => [datapoints.get(`${source}:station`)?.value, datapoints.get(`${source}:volume`)?.value, stationsOf(source).length], apply, { immediate: true });
}

/** Holt einen vom Browser verweigerten Start nach – aufzurufen aus einem Antippen heraus. */
export function resumePlayback(): void {
  void context?.resume();
  if (audio?.dataset.station) void audio.play().then(() => (playbackBlocked.value = false));
}
