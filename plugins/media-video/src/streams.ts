/** Wie eine Videoquelle zur Anzeige gelangt. */
export type Mode = 'webrtc' | 'hls' | 'mjpeg';

export interface StreamConfig {
  id: string;
  name: string;
  /** Adresse der Quelle. Fehlt sie, steht sie in `secrets.json` unter der Kennung des Streams. */
  url?: string;
  /** Erzwingt einen Weg; ohne Angabe ergibt er sich aus der Adresse. */
  mode?: Mode;
}

const STREAM_ID = /^[a-z0-9][a-z0-9-]*$/;

export function isStreamId(value: unknown): value is string {
  return typeof value === 'string' && STREAM_ID.test(value);
}

/**
 * Wählt den Weg zur Anzeige nach der Adresse:
 * - HLS-Listen spielt der Browser selbst ab,
 * - alles andere bereitet go2rtc auf und liefert es als WebRTC – RTSP-Kameras,
 *   aber auch Quellen, die go2rtc über eigene Präfixe wie "ffmpeg:" anspricht.
 */
export function modeOf(url: string, forced?: Mode): Mode {
  if (forced) return forced;
  if (/^https?:\/\/[^?#]+\.m3u8(\?|#|$)/i.test(url)) return 'hls';
  return 'webrtc';
}

/** Setzt eine Zeichenkette so, dass sie in einer YAML-Datei unverändert ankommt. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

export interface Go2rtcSettings {
  apiPort: number;
  rtspPort: number;
  webrtcPort: number;
  ffmpeg?: string;
}

/**
 * Erzeugt die Einstellungsdatei für go2rtc. Die Verwaltungsschnittstelle hört nur
 * auf dem eigenen Rechner – von außen ist go2rtc allein über den Kern erreichbar.
 */
export function go2rtcYaml(settings: Go2rtcSettings, streams: readonly { id: string; url: string }[]): string {
  const lines = [
    '# Von Culinola erzeugt – Änderungen gehen beim nächsten Start verloren.',
    'api:',
    `  listen: ${yamlString(`127.0.0.1:${settings.apiPort}`)}`,
    // go2rtc reicht umgewandelte Quellen (ffmpeg) intern über RTSP weiter – auch das nur auf dem eigenen Rechner
    'rtsp:',
    `  listen: ${yamlString(`127.0.0.1:${settings.rtspPort}`)}`,
    'webrtc:',
    `  listen: ${yamlString(`:${settings.webrtcPort}`)}`,
  ];
  if (settings.ffmpeg) lines.push('ffmpeg:', `  bin: ${yamlString(settings.ffmpeg)}`);
  lines.push('streams:');
  for (const stream of streams) lines.push(`  ${stream.id}: ${yamlString(stream.url)}`);
  return `${lines.join('\n')}\n`;
}
