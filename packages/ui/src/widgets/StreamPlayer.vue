<script setup lang="ts">
import Hls from 'hls.js';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson, postJson } from '../api.ts';
import { mediaUrl } from '../media.ts';

interface StreamInfo {
  id: string;
  name: string;
  /** `file`: eine aufgezeichnete Videodatei, die in Schleife läuft – so zeigt die Demo ihre Kameras. */
  mode: 'webrtc' | 'hls' | 'mjpeg' | 'file';
  url?: string;
  /** Fernsehsender: Hier zählt ein ruhiges Bild mehr als geringe Verzögerung. */
  tv?: boolean;
}

const props = defineProps<{
  source: string;
  stream: string;
  /** Kameras bleiben stumm; beim Fernsehen gehört der Ton dazu. */
  muted?: boolean;
  /** Lautstärke 0 bis 1 für Quellen mit Ton. */
  volume?: number;
  /**
   * Seitenverhältnis, in dem das Bild gezeigt wird, etwa 16 / 9. Fernsehsender in Standardauflösung übertragen
   * 720×576 Bildpunkte, die erst gestreckt ein Bild in 16:9 ergeben – der Browser weiß davon nichts und zeigte
   * es sonst gestaucht. Ohne Angabe gilt das Verhältnis, das der Strom selbst mitbringt.
   */
  aspect?: number;
  /**
   * Wie das Bild seine Fläche nutzt: `contain` zeigt es ganz und lässt Ränder frei, `cover` füllt die Fläche und
   * schneidet dafür am Rand ab, `fill` füllt sie ganz und verzerrt dabei. Ohne Angabe `contain`.
   */
  fit?: 'contain' | 'cover' | 'fill';
}>();

const { t } = useI18n();
const RETRY_MS = 4000;
/**
 * Empfangspuffer für Fernsehen. Ein Tvheadend liefert seine Daten stoßweise, und WebRTC gibt sie sonst
 * so schnell wie möglich weiter – das Bild stockt dann immer wieder kurz. Kameras bleiben ohne Puffer.
 */
const TV_BUFFER_MS = 1000;
const video = ref<HTMLVideoElement>();
const info = ref<StreamInfo>();
const state = ref<'loading' | 'playing' | 'failed'>('loading');
const soundBlocked = ref(false);

let peer: RTCPeerConnection | undefined;
let hls: Hls | undefined;
let retry: number | undefined;
let generation = 0;

function stop() {
  window.clearTimeout(retry);
  peer?.close();
  peer = undefined;
  hls?.destroy();
  hls = undefined;
  if (video.value) {
    video.value.onerror = null;
    video.value.srcObject = null;
    video.value.removeAttribute('src');
  }
}

/** Nach einem Abbruch selbstständig neu verbinden. */
function fail(run: number) {
  if (run !== generation) return;
  state.value = 'failed';
  stop();
  retry = window.setTimeout(() => void start(), RETRY_MS);
}

async function start() {
  const run = ++generation;
  stop();
  state.value = 'loading';
  try {
    const list = await getJson<StreamInfo[]>(`/resources/${encodeURIComponent(props.source)}/streams`);
    if (run !== generation) return;
    info.value = list.find((entry) => entry.id === props.stream);
    if (!info.value) return fail(run);
    if (info.value.mode === 'webrtc') await startWebrtc(run);
    else if (info.value.mode === 'hls') startHls(run, info.value.url ?? '');
    else if (info.value.mode === 'file') startFile(run, info.value.url ?? '');
    else state.value = 'playing';
  } catch {
    fail(run);
  }
}

async function startWebrtc(run: number) {
  const connection = new RTCPeerConnection();
  peer = connection;
  connection.addTransceiver('video', { direction: 'recvonly' });
  connection.addTransceiver('audio', { direction: 'recvonly' });
  const media = new MediaStream();
  connection.ontrack = (event) => {
    // Nicht jeder Browser kennt den Puffer; dann läuft das Bild eben ohne
    if (info.value?.tv && 'jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = TV_BUFFER_MS;
    media.addTrack(event.track);
    if (video.value && video.value.srcObject !== media) video.value.srcObject = media;
    void play();
  };
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === 'connected') state.value = 'playing';
    if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') fail(run);
  };

  await connection.setLocalDescription(await connection.createOffer());
  // go2rtc erwartet die Verbindungswege gleich im Angebot – kurz warten, bis der Browser sie gesammelt hat
  await new Promise<void>((resolve) => {
    if (connection.iceGatheringState === 'complete') return resolve();
    const timer = window.setTimeout(resolve, 1500);
    connection.onicegatheringstatechange = () => {
      if (connection.iceGatheringState === 'complete') {
        window.clearTimeout(timer);
        resolve();
      }
    };
  });
  if (run !== generation) return connection.close();

  const answer = await postJson<{ sdp: string }>(`/p/${encodeURIComponent(props.source)}/webrtc/${encodeURIComponent(props.stream)}`, {
    sdp: connection.localDescription?.sdp,
  });
  if (run !== generation) return connection.close();
  await connection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
}

/**
 * Startet die Wiedergabe. Mit Ton verweigern Browser den Start, wenn ihm kein Antippen
 * unmittelbar vorausging – dann läuft das Bild zunächst stumm, und ein Tipp holt den Ton nach.
 */
async function play() {
  const element = video.value;
  if (!element) return;
  try {
    await element.play();
    soundBlocked.value = false;
  } catch {
    if (element.muted) return;
    element.muted = true;
    soundBlocked.value = true;
    await element.play().catch(() => undefined);
  }
}

function unmute() {
  if (!video.value) return;
  video.value.muted = false;
  soundBlocked.value = false;
  void video.value.play();
}

function startHls(run: number, url: string) {
  const element = video.value;
  if (!element || !url) return fail(run);
  if (Hls.isSupported()) {
    hls = new Hls({ liveSyncDurationCount: 3 });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) fail(run);
    });
    hls.loadSource(url);
    hls.attachMedia(element);
    hls.on(Hls.Events.MANIFEST_PARSED, () => void play());
  } else {
    // Safari spielt HLS ohne Hilfe
    element.src = url;
  }
  element.onplaying = () => (state.value = 'playing');
}

function startFile(run: number, url: string) {
  const element = video.value;
  if (!element || !url) return fail(run);
  element.loop = true;
  element.src = url;
  element.onplaying = () => (state.value = 'playing');
  element.onerror = () => fail(run);
  void play();
}

watch(
  () => [props.volume, props.muted],
  () => {
    if (!video.value) return;
    video.value.muted = props.muted ?? true;
    video.value.volume = Math.min(1, Math.max(0, props.volume ?? 1));
  },
);
watch(() => [props.source, props.stream], () => void start());
onMounted(() => {
  if (video.value) {
    video.value.muted = props.muted ?? true;
    video.value.volume = Math.min(1, Math.max(0, props.volume ?? 1));
  }
  void start();
});
onUnmounted(() => {
  generation++;
  stop();
});
</script>

<template>
  <div class="player" :class="{ forced: !!props.aspect }" :style="{ ...(props.aspect ? { '--aspect': String(props.aspect) } : {}), '--fit': props.fit ?? 'contain' }">
    <img v-if="info?.mode === 'mjpeg'" :src="mediaUrl(`/p/${encodeURIComponent(source)}/mjpeg/${encodeURIComponent(stream)}`)" :alt="info.name" />
    <video v-else ref="video" autoplay playsinline></video>
    <span v-if="state !== 'playing'" class="state">{{ t(state === 'failed' ? 'video.reconnecting' : 'video.connecting') }}</span>
    <!-- Kein eigenes button-Element: Der Spieler sitzt selbst in einer Schaltfläche (Vollbild) -->
    <span v-if="soundBlocked" class="sound" role="button" tabindex="0" @click.stop="unmute" @keydown.enter.stop="unmute">{{ t('video.tapForSound') }}</span>
  </div>
</template>

<style scoped>
.player {
  container-type: size;
  position: absolute;
  inset: 0;
  background: #0b0f13;
}
/* Vorgegebenes Seitenverhältnis: die größte Fläche dieses Verhältnisses, mittig, und das Bild füllt sie ganz */
.player.forced video,
.player.forced img {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(100cqw, calc(100cqh * var(--aspect)));
  height: min(100cqh, calc(100cqw / var(--aspect)));
  transform: translate(-50%, -50%);
  object-fit: fill;
}
video,
img {
  width: 100%;
  height: 100%;
  object-fit: var(--fit, contain);
  display: block;
}
.sound {
  position: absolute;
  top: 10px;
  right: 10px;
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-size: 15px;
  font-weight: 600;
}
.state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #b8c2cc;
  font-size: 15px;
}
</style>
