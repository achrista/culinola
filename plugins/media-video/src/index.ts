import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { definePlugin, type PluginRequest } from '@culinola/sdk';
import { go2rtcYaml, isStreamId, type Mode, modeOf, type StreamConfig, type TvEngine, tvSource, tvTemplates, VAAPI_DEVICE, vaapiProbeArgs } from './streams.ts';

interface Config {
  streams: StreamConfig[];
  go2rtc: {
    /** Pfad zum Programm go2rtc. Ist er gesetzt, startet Culinola es selbst; sonst muss es schon laufen. */
    binary?: string;
    apiPort: number;
    rtspPort: number;
    webrtcPort: number;
    /** Pfad zu ffmpeg, falls go2rtc Quellen umwandeln soll (etwa Fernsehsender). */
    ffmpeg?: string;
  };
}

const START_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_ATTEMPTS = 3;
const PROBE_RETRY_MS = 20_000;

export default definePlugin<Config>({
  id: 'media-video',
  name: { de: 'Kameras und Fernsehbild', en: 'Cameras and TV picture' },
  text: { de: 'Live-Bilder von Kameras und Fernsehsendern über go2rtc.', en: 'Live pictures from cameras and TV stations via go2rtc.' },
  help: { de: 'Braucht das Programm go2rtc, das nicht mitgeliefert wird; mit „Pfad zum Programm“ startet Culinola es selbst.\nAdressen ohne Kennwort stehen bei der Videoquelle. Enthält die Adresse einer Kamera Benutzer und Kennwort (rtsp://name:kennwort@…), gehört sie zu den Zugangsdaten: unter „Weitere Zugangsangabe“ als Name die Kennung der Videoquelle und als Wert die ganze Adresse eintragen.', en: 'Needs the program go2rtc, which is not included; with “Path to the program” Culinola starts it itself.\nAddresses without a password go with the video stream. If the address of a camera contains user and password (rtsp://name:password@…), it belongs with the credentials: under “Further credential” enter the id of the stream as name and the whole address as value.' },
  settings: [
    { key: 'streams', type: 'list', label: { de: 'Videoquellen', en: 'Video streams' }, fields: [{ key: 'id', type: 'text', label: { de: 'Kennung', en: 'Id' }, hint: { de: 'Kleinbuchstaben, Ziffern, Bindestriche.', en: 'Lower-case letters, digits, hyphens.' } }, { key: 'name', type: 'text', label: { de: 'Name', en: 'Name' } }, { key: 'url', type: 'text', label: { de: 'Adresse', en: 'Address' }, hint: { de: 'Enthält sie ein Kennwort, gehört sie zu den Zugangsdaten – unter der Kennung der Videoquelle.', en: 'If it contains a password it belongs with the credentials – under the id of the stream.' } }, { key: 'mode', type: 'select', label: { de: 'Weg', en: 'Transport' }, options: ['', 'webrtc', 'hls', 'mjpeg'] }, { key: 'tv', type: 'boolean', label: { de: 'Fernsehsender (Bild wird für den Browser umgerechnet)', en: 'TV station (picture is converted for the browser)' } }] },
    { key: 'go2rtc', type: 'group', label: { de: 'go2rtc', en: 'go2rtc' }, fields: [{ key: 'binary', type: 'text', label: { de: 'Pfad zum Programm', en: 'Path to the program' }, hint: { de: 'Ist er gesetzt, startet Culinola go2rtc selbst; sonst muss es schon laufen.', en: 'If set, Culinola starts go2rtc itself; otherwise it must already be running.' } }, { key: 'ffmpeg', type: 'text', label: { de: 'Pfad zu ffmpeg', en: 'Path to ffmpeg' } }, { key: 'apiPort', type: 'number', label: { de: 'Port der API', en: 'API port' }, min: 1, max: 65535, placeholder: 1984 }, { key: 'rtspPort', type: 'number', label: { de: 'Port für RTSP', en: 'RTSP port' }, min: 1, max: 65535, placeholder: 8554 }, { key: 'webrtcPort', type: 'number', label: { de: 'Port für WebRTC', en: 'WebRTC port' }, min: 1, max: 65535, placeholder: 8555 }] },
  ],

  parseConfig(raw) {
    const config = raw as Partial<Config>;
    if (!Array.isArray(config.streams)) throw new Error('"streams" fehlt oder ist keine Liste.');
    const seen = new Set<string>();
    for (const stream of config.streams) {
      if (!isStreamId(stream.id)) throw new Error(`Videoquelle "${stream.name ?? '?'}": "id" fehlt oder enthält anderes als Kleinbuchstaben, Ziffern und Bindestriche.`);
      if (seen.has(stream.id)) throw new Error(`Kennung "${stream.id}" ist doppelt vergeben.`);
      seen.add(stream.id);
      if (!stream.name) throw new Error(`Videoquelle "${stream.id}": "name" fehlt.`);
    }
    const go2rtc = config.go2rtc ?? ({} as Partial<Config['go2rtc']>);
    return {
      streams: config.streams,
      go2rtc: {
        apiPort: go2rtc.apiPort ?? 1984,
        rtspPort: go2rtc.rtspPort ?? 8554,
        webrtcPort: go2rtc.webrtcPort ?? 8555,
        ...(go2rtc.binary ? { binary: go2rtc.binary } : {}),
        ...(go2rtc.ffmpeg ? { ffmpeg: go2rtc.ffmpeg } : {}),
      },
    };
  },

  async start(context) {
    const { config, log } = context;
    const api = `http://127.0.0.1:${config.go2rtc.apiPort}`;

    // Fernsehbilder rechnet der Grafikchip um, wenn ffmpeg ihn ansprechen kann – sonst der Prozessor.
    // Eigene Vorlagen dafür gibt es nur, wenn Culinola go2rtc selbst startet.
    const hasTv = config.streams.some((stream) => stream.tv);
    const probe = hasTv && config.go2rtc.binary ? await probeTvEngine(config.go2rtc.ffmpeg ?? 'ffmpeg', context.signal) : { engine: 'cpu' as const };
    const engine: TvEngine = probe.engine;
    if (engine === 'vaapi') log.info('Fernsehbilder rechnet der Grafikchip um (VAAPI).');
    else if (probe.problem) log.warn(`Fernsehbilder rechnet der Prozessor um – der Grafikchip ist da, aber ffmpeg kann ihn nicht nutzen: ${probe.problem}`);
    else if (hasTv) log.info('Fernsehbilder rechnet der Prozessor um.');

    // Adressen kommen aus der Konfiguration oder – mit Zugangsdaten – aus secrets.json
    const streams = new Map<string, { name: string; url: string; mode: Mode; tv: boolean }>();
    for (const stream of config.streams) {
      const address = stream.url ?? context.secrets.get(stream.id);
      if (!address) {
        log.warn(`Videoquelle "${stream.id}" hat keine Adresse – weder in der Konfiguration noch in secrets.json.`);
        continue;
      }
      const url = stream.tv ? tvSource(address, engine, Boolean(config.go2rtc.binary)) : address;
      streams.set(stream.id, { name: stream.name, url, mode: modeOf(url, stream.mode), tv: stream.tv === true });
    }
    const viaGo2rtc = [...streams].filter(([, stream]) => stream.mode === 'webrtc').map(([id, stream]) => ({ id, url: stream.url }));

    if (viaGo2rtc.length > 0 && config.go2rtc.binary) {
      const file = join(context.storageDir, 'go2rtc.yaml');
      writeFileSync(file, go2rtcYaml({ ...config.go2rtc, templates: tvTemplates(engine) }, viaGo2rtc), { mode: 0o600 });
      const child = spawn(config.go2rtc.binary, ['-config', file], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      watch(child, log);
      context.signal.addEventListener('abort', () => child.kill());
      // Der Kern soll go2rtc nicht verwaist zurücklassen, wenn er selbst endet.
      process.on('exit', () => child.kill());
      await waitUntilUp(api, context.signal);
      log.info(`go2rtc gestartet, ${viaGo2rtc.length} Quellen eingerichtet.`);
    } else if (viaGo2rtc.length > 0) {
      for (const stream of viaGo2rtc) {
        const response = await fetch(`${api}/api/streams?name=${encodeURIComponent(stream.id)}&src=${encodeURIComponent(stream.url)}`, { method: 'PUT', signal: context.signal });
        if (!response.ok) throw new Error(`go2rtc nimmt die Quelle "${stream.id}" nicht an (${response.status}).`);
      }
      log.info(`${viaGo2rtc.length} Quellen bei laufendem go2rtc angemeldet.`);
    }

    // Die Anzeige erfährt Namen und Weg, aber keine Adresse mit Zugangsdaten.
    // Nur öffentliche HLS-Adressen aus der Konfiguration gehen direkt an den Browser.
    // Kameras, die ihr Bild als Einzelbildfolge liefern, lassen sich nicht per WebRTC übertragen;
    // sie werden beim ersten Versuch erkannt und danach als Bildfolge über go2rtc gezeigt.
    const asImages = new Set<string>();
    const publish = () =>
      context.resources.set(
        'streams',
        config.streams
          .filter((stream) => streams.has(stream.id))
          .map((stream) => {
            const entry = streams.get(stream.id)!;
            const mode = asImages.has(stream.id) ? 'mjpeg' : entry.mode;
            return { id: stream.id, name: stream.name, mode, ...(mode === 'hls' && stream.url ? { url: stream.url } : {}), ...(stream.tv ? { tv: true } : {}) };
          }),
      );
    publish();

    // Dieselbe Störung nur einmal melden, nicht bei jedem neuen Verbindungsversuch der Anzeige
    const reported = new Map<string, string>();
    const report = (id: string, message: string) => {
      if (reported.get(id) === message) return;
      reported.set(id, message);
      log.warn(message);
    };

    // Verbindungsaufbau für WebRTC: Die Anzeige schickt ihr Angebot an den Kern, der es an go2rtc weiterreicht.
    // Ein Bild ansehen ist Lesen – auch eine Anzeige, die nichts schalten darf, zeigt Kameras.
    context.routes.post('/webrtc/:id', webrtc, { role: 'read' });
    async function webrtc(request: PluginRequest): Promise<Response> {
      const stream = streams.get(request.params.id ?? '');
      const offer = (request.body as { sdp?: unknown } | null)?.sdp;
      if (!stream || stream.mode !== 'webrtc') return Response.json({ error: 'Videoquelle unbekannt.' }, { status: 404 });
      if (typeof offer !== 'string') return Response.json({ error: 'Im Rumpf fehlt "sdp".' }, { status: 400 });

      const response = await fetch(`${api}/api/webrtc?src=${encodeURIComponent(request.params.id!)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'offer', sdp: offer }),
        signal: request.signal,
      });
      const id = request.params.id!;
      if (!response.ok) {
        const detail = (await response.text()).trim();
        // go2rtc meldet "Angebot der Quelle => Wünsche des Browsers"; steht links nur JPEG, liefert die Kamera Einzelbilder
        const offered = detail.split('=>')[0] ?? '';
        if (/video:JPEG/.test(offered) && !/video:H26[45]/.test(offered)) {
          asImages.add(id);
          publish();
          log.info(`Videoquelle "${stream.name}" liefert Einzelbilder und wird als Bildfolge gezeigt.`);
          return Response.json({ error: `Videoquelle "${stream.name}" wird als Bildfolge gezeigt.` }, { status: 409 });
        }
        report(id, `Videoquelle "${stream.name}" liefert kein Bild: ${detail.slice(0, 160) || response.status}`);
        return Response.json({ error: `Videoquelle "${stream.name}" liefert kein Bild.` }, { status: 502 });
      }
      reported.delete(id);
      const answer = (await response.json()) as { sdp?: string };
      return Response.json({ sdp: answer.sdp });
    }

    // Kameras, die ihr Bild als fortlaufende Bildfolge über HTTP liefern, reicht der Kern durch.
    context.routes.get('/mjpeg/:id', async (request) => {
      const id = request.params.id ?? '';
      const stream = streams.get(id);
      if (!stream || (stream.mode !== 'mjpeg' && !asImages.has(id))) return Response.json({ error: 'Videoquelle unbekannt.' }, { status: 404 });
      // Direkt von der Kamera – oder, bei einer über go2rtc laufenden Quelle, von dort als Bildfolge
      return relay(request, id, stream, stream.mode === 'mjpeg' ? stream.url : `${api}/api/stream.mjpeg?src=${encodeURIComponent(id)}`, 'multipart/x-mixed-replace');
    });

    // Fernsehen kommt als fortlaufender MP4-Strom statt über WebRTC. Der Browser legt sich dabei einen Vorrat an
    // wie ein gewöhnlicher Abspieler und gleicht so aus, dass ein Tvheadend seine Daten stoßweise liefert.
    // WebRTC dagegen verwirft, was zu spät kommt – das Bild ruckelt und verliert Einzelbilder.
    context.routes.get('/mp4/:id', async (request) => {
      const id = request.params.id ?? '';
      const stream = streams.get(id);
      if (!stream || !stream.tv || stream.mode !== 'webrtc') return Response.json({ error: 'Videoquelle unbekannt.' }, { status: 404 });
      return relay(request, id, stream, `${api}/api/stream.mp4?src=${encodeURIComponent(id)}`, 'video/mp4');
    });

    // Reicht einen fortlaufenden Strom von der Kamera oder von go2rtc an die Anzeige durch.
    async function relay(request: PluginRequest, id: string, stream: { name: string }, from: string, type: string): Promise<Response> {
      try {
        const upstream = await fetch(from, { signal: request.signal });
        if (!upstream.ok || !upstream.body) {
          report(id, `Videoquelle "${stream.name}" antwortet mit ${upstream.status}.`);
          return Response.json({ error: `Videoquelle antwortet mit ${upstream.status}.` }, { status: 502 });
        }
        reported.delete(id);
        return new Response(upstream.body, { headers: { 'Content-Type': upstream.headers.get('content-type') ?? type, 'Cache-Control': 'no-store' } });
      } catch {
        if (!request.signal.aborted) report(id, `Videoquelle "${stream.name}" ist nicht erreichbar.`);
        return Response.json({ error: `Videoquelle "${stream.name}" ist nicht erreichbar.` }, { status: 502 });
      }
    }
  },
});

/** Reicht Warnungen und Fehler von go2rtc ins Protokoll durch – ohne Adressen, die Zugangsdaten enthalten könnten. */
function watch(child: ChildProcess, log: { warn(message: string): void; error(message: string): void }): void {
  const redact = (text: string) => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s"@/]+@/gi, '$1…@');
  // go2rtc meldet dieselbe Störung bei jedem Verbindungsversuch, meist doppelt als Warnung und
  // als Fehler. Ins Protokoll kommt sie einmal je Minute.
  const REPEAT_MS = 60_000;
  const seen = new Map<string, number>();
  const onData = (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (!/\b(WRN|ERR|FTL)\b/.test(line)) continue;
      // Zeitstempel, Stufe und Fundstelle im Quelltext weglassen
      const message = redact(line.trim())
        .replace(/^[\d:.]+\s+/, '')
        .replace(/^(WRN|ERR|FTL)\s+/, '')
        .replace(/\S+\.go:\d+ > /, '');
      const now = Date.now();
      if (now - (seen.get(message) ?? 0) < REPEAT_MS) continue;
      seen.set(message, now);
      log.warn(`go2rtc: ${message.slice(0, 200)}`);
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', (error) => log.error(`go2rtc lässt sich nicht starten: ${error.message}`));
  child.on('exit', (code) => {
    if (code !== null && code !== 0) log.error(`go2rtc hat sich mit Code ${code} beendet.`);
  });
}

/**
 * Probiert aus, ob ffmpeg mit dem Grafikchip umrechnen kann – nur unter Linux und wenn das Gerät da ist.
 * Scheitert es trotz Gerät, nennt `problem` den Grund (meist fehlender Treiber oder fehlende Rechte).
 * Gleich nach dem Hochfahren des Rechners ist der Grafikchip mitunter noch nicht bereit, oder die Prüfung
 * kommt unter der Startlast nicht rechtzeitig durch – deshalb gibt es mehrere Versuche.
 */
async function probeTvEngine(ffmpeg: string, signal: AbortSignal): Promise<{ engine: TvEngine; problem?: string }> {
  if (process.platform !== 'linux' || !existsSync(VAAPI_DEVICE)) return { engine: 'cpu' };
  let problem = '';
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS && !signal.aborted; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_MS));
    problem = await new Promise<string>((resolve) => {
      execFile(ffmpeg, vaapiProbeArgs(), { timeout: PROBE_TIMEOUT_MS, signal, windowsHide: true }, (error, _stdout, stderr) => {
        if (!error) return resolve('');
        if (error.killed) return resolve(`keine Antwort nach ${PROBE_TIMEOUT_MS / 1000} s`);
        resolve(String(stderr).trim().split('\n').at(-1) || error.message);
      });
    });
    if (!problem) return { engine: 'vaapi' };
  }
  return { engine: 'cpu', problem: problem.slice(0, 200) };
}

async function waitUntilUp(api: string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline && !signal.aborted) {
    try {
      if ((await fetch(`${api}/api`, { signal })).ok) return;
    } catch {
      // noch nicht bereit
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`go2rtc antwortet nach ${START_TIMEOUT_MS / 1000} s nicht auf ${api}.`);
}
