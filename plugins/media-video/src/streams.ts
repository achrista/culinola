/** Wie eine Videoquelle zur Anzeige gelangt. */
export type Mode = 'webrtc' | 'hls' | 'mjpeg';

export interface StreamConfig {
  id: string;
  name: string;
  /** Adresse der Quelle. Fehlt sie, steht sie in `secrets.json` unter der Kennung des Streams. */
  url?: string;
  /** Erzwingt einen Weg; ohne Angabe ergibt er sich aus der Adresse. */
  mode?: Mode;
  /**
   * Fernsehsender, etwa von einem Tvheadend: Das Bild wird für den Browser umgerechnet –
   * vom Zeilensprung befreit und auf 1024×576 gebracht. Die Adresse ist die des Senders selbst.
   */
  tv?: boolean;
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

/** Womit go2rtc Fernsehbilder umrechnet: mit dem Grafikchip über VAAPI oder mit dem Prozessor. */
export type TvEngine = 'vaapi' | 'cpu';

export const VAAPI_DEVICE = '/dev/dri/renderD128';

/**
 * Fernsehen kommt im Zeilensprung (576i, 1080i) und mit B-Frames, die WebRTC im Browser nicht
 * abspielt – durchreichen geht also nicht. Umgerechnet wird auf 1024×576 mit 25 Bildern je Sekunde:
 * Das genügt einer Küchenanzeige und hält die Last klein. Ohne Grafikchip schafft ein schwacher
 * Rechner Sender in voller HD-Auflösung trotzdem oft nicht in Echtzeit.
 */
const TV_FILTER_CPU = 'yadif=deint=interlaced,fps=25,scale=1024:576,setsar=1';
const TV_FILTER_VAAPI = 'format=vaapi|nv12,hwupload,deinterlace_vaapi=rate=frame:auto=1,scale_vaapi=w=1024:h=576:format=nv12';

/** Eigene ffmpeg-Vorlagen für go2rtc; nur nötig, wenn der Grafikchip rechnet. */
export function tvTemplates(engine: TvEngine): Record<string, string> {
  if (engine !== 'vaapi') return {};
  return {
    'tv-vaapi-input': `-init_hw_device vaapi=va:${VAAPI_DEVICE} -filter_hw_device va -hwaccel vaapi -hwaccel_device va -hwaccel_output_format vaapi -fflags nobuffer -flags low_delay -i {input}`,
    'tv-vaapi': `-vf ${TV_FILTER_VAAPI} -c:v h264_vaapi -g 50 -bf 0 -profile:v high -level:v 4.1 -sei:v 0 -aspect 16:9`,
  };
}

/** Die Quelle, die go2rtc für einen Fernsehsender bekommt. Eine Adresse mit "ffmpeg:" bleibt, wie sie ist. */
export function tvSource(url: string, engine: TvEngine): string {
  if (url.startsWith('ffmpeg:')) return url;
  return engine === 'vaapi' ? `ffmpeg:${url}#input=tv-vaapi-input#video=tv-vaapi#audio=opus` : `ffmpeg:${url}#video=h264#raw=-vf ${TV_FILTER_CPU}#audio=opus`;
}

/** Prüfaufruf für ffmpeg: Gelingt er, kann der Grafikchip Fernsehbilder umrechnen. */
export function vaapiProbeArgs(): string[] {
  return ['-hide_banner', '-v', 'error', '-init_hw_device', `vaapi=va:${VAAPI_DEVICE}`, '-filter_hw_device', 'va', '-f', 'lavfi', '-i', 'testsrc2=size=720x576:rate=25', '-frames:v', '10', '-vf', TV_FILTER_VAAPI, '-c:v', 'h264_vaapi', '-bf', '0', '-f', 'null', '-'];
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
  /** Eigene ffmpeg-Vorlagen, auf die Quellen mit #input= und #video= verweisen. */
  templates?: Record<string, string>;
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
  const templates = Object.entries(settings.templates ?? {});
  if (settings.ffmpeg || templates.length > 0) lines.push('ffmpeg:');
  if (settings.ffmpeg) lines.push(`  bin: ${yamlString(settings.ffmpeg)}`);
  for (const [name, args] of templates) lines.push(`  ${name}: ${yamlString(args)}`);
  lines.push('streams:');
  for (const stream of streams) lines.push(`  ${stream.id}: ${yamlString(stream.url)}`);
  return `${lines.join('\n')}\n`;
}
