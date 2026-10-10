<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { postJson } from '../api.ts';
import { region } from '../i18n.ts';
import { mediaUrl } from '../media.ts';
import { chime } from '../sound.ts';
import { datapoints } from '../store.ts';
import { afterWakeWord, listenForSpeech, type WakeListener } from '../wake.ts';

/** Was der Browser unter `SpeechRecognition` anbietet – nur das, was hier gebraucht wird. */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface Answer {
  reply: string;
  actions: { action: string; ok: boolean }[];
  /** Namen der Werte, die für die Antwort gelesen wurden. */
  values?: string[];
}

/**
 * Sprechen statt tippen: Antippen, einen Satz sagen – „Eieruhr auf acht Minuten“, „Setz Milch auf die
 * Einkaufsliste“. Den Satz versteht der Browser, zugeordnet und ausgeführt wird er im Kern, und die
 * Antwort liest die Anzeige vor. Wo der Browser keine Spracherkennung hat, lässt sich der Satz tippen.
 */
const props = defineProps<{
  config: {
    source?: string;
    title?: string;
    /** `false` schaltet das Vorlesen der Antwort ab. */
    speak?: boolean;
    /**
     * Aktivierungswort, etwa "computer": Diese Anzeige hört dann dauernd mit – auf dem Gerät selbst – und führt aus,
     * was nach dem Wort gesagt wird. Es muss ein gewöhnliches Wort sein, das das Sprachmodell kennt.
     */
    wakeWord?: string;
  };
}>();

const HIDE_AFTER_MS = 9000;
const { t } = useI18n();
const source = computed(() => props.config.source ?? 'voice');
const ready = computed(() => datapoints.get(`${source.value}:ready`)?.value === true);
const available = (() => {
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
})();

const state = ref<'idle' | 'listening' | 'thinking' | 'answer'>('idle');
const open = ref(false);
const heard = ref('');
const reply = ref('');
const trouble = ref('');
const typing = ref(false);
const typed = ref('');
const field = ref<HTMLInputElement>();
let recognition: Recognition | undefined;
let hide: number | undefined;

// Aktivierungswort: ein Sprachmodell im Browser hört mit; was es versteht, bleibt auf dem Gerät, bis das Wort fällt
/** So lange wartet die Anzeige auf den Satz – ab dem Wort, und neu ab jedem Stück, das sie hört. */
const ARMED_MS = 8000;
/** So lange nach einem eigenen Ton oder Satz wertet die Anzeige nichts: Sie soll sich nicht selbst zuhören. */
const ECHO_MS = 1200;
const wakeWord = computed(() => props.config.wakeWord?.trim().toLowerCase() ?? '');
const hasModel = computed(() => datapoints.get(`${source.value}:model`)?.value === true);
const wake = ref<'off' | 'loading' | 'on' | 'failed'>('off');
const hearing = ref(false);
let wakeListener: WakeListener | undefined;
let armedUntil = 0;
let armTimer: number | undefined;
let quietUntil = 0;
/** Der letzte Wortwechsel, der nichts ausgelöst hat – er geht mit, wenn gleich darauf nachgesetzt wird. */
let unresolved: { text: string; reply: string } | undefined;

const armed = () => Date.now() < armedUntil;
/** Solange die Anzeige selbst spricht oder schon etwas bearbeitet, hört sie nicht auf sich. */
function deaf(): boolean {
  if ('speechSynthesis' in window && speechSynthesis.speaking) quietUntil = Math.max(quietUntil, Date.now() + ECHO_MS);
  return state.value === 'thinking' || state.value === 'listening' || Date.now() < quietUntil;
}
function showHearing(text: string, keepReply = false) {
  window.clearTimeout(hide);
  open.value = true;
  typing.value = false;
  hearing.value = true;
  heard.value = text;
  if (!keepReply) reply.value = '';
  trouble.value = '';
}
/** Räumt auf, wenn nach dem Warten nichts mehr kommt – und wartet weiter, solange noch gesprochen wird. */
function watchArm() {
  window.clearTimeout(armTimer);
  armTimer = window.setTimeout(
    () => {
      if (armed()) return watchArm();
      if (hearing.value && state.value !== 'thinking') close();
    },
    Math.max(250, armedUntil - Date.now()),
  );
}
/** Wartet auf den nächsten Satz – nach einer kurzen Pause, in der eigener Ton oder eigene Sprache verklingt. */
function arm(pause: number, keepReply = false) {
  quietUntil = Math.max(quietUntil, Date.now() + pause);
  armedUntil = Date.now() + pause + ARMED_MS;
  showHearing('', keepReply);
  watchArm();
}
function wakePartial(text: string) {
  if (deaf()) return;
  const found = afterWakeWord(text, wakeWord.value);
  if (!found.woke && !armed()) return;
  // Wer spricht, wird nicht mittendrin abgeschnitten: Die Wartezeit beginnt mit jedem gehörten Stück neu
  armedUntil = Date.now() + ARMED_MS;
  watchArm();
  showHearing(found.woke ? found.command : text, !found.woke);
}
function wakeFinal(text: string) {
  if (deaf()) return;
  const found = afterWakeWord(text, wakeWord.value);
  if (!found.woke && !armed()) return;
  const command = found.woke ? found.command : text;
  // Mit dem Wort beginnt etwas Neues; ohne es wird nachgesetzt
  if (found.woke) unresolved = undefined;
  if (!command) {
    // Nur das Wort: ein Ton als Zeichen, und der nächste Satz ist gemeint
    chime();
    return arm(600);
  }
  armedUntil = 0;
  window.clearTimeout(armTimer);
  void send(command, true);
}
async function startWake() {
  if (wakeListener || wake.value === 'loading') return;
  wake.value = 'loading';
  try {
    const modelUrl = new URL(mediaUrl(`/p/${encodeURIComponent(source.value)}/model`), location.href).href;
    wakeListener = await listenForSpeech({ modelUrl, onPartial: wakePartial, onFinal: wakeFinal });
    wake.value = 'on';
  } catch {
    // Kein Mikrofon, keine Erlaubnis, keine gesicherte Verbindung oder kein Modell: Die Taste bleibt benutzbar
    wake.value = 'failed';
  }
}
watch(
  () => !!wakeWord.value && hasModel.value,
  (wanted) => {
    if (wanted) void startWake();
  },
  { immediate: true },
);

/** Liest vor und meldet, wenn es damit fertig ist – auch dann, wenn gar nicht vorgelesen wird. */
function speak(text: string, done?: () => void) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done?.();
  };
  if (props.config.speak === false || !('speechSynthesis' in window)) return finish();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onend = finish;
  utterance.onerror = finish;
  // Manche Browser melden das Ende nicht zuverlässig; dann gilt eine großzügige Schätzung
  window.setTimeout(finish, 2500 + text.length * 110);
  utterance.lang = region.value;
  const language = region.value.split('-')[0]!;
  // Eine Stimme in der Sprache der Anzeige; die auf dem Gerät vorhandene geht vor, weil sie ohne Netz spricht
  const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith(language));
  const voice = voices.find((entry) => entry.localService) ?? voices[0];
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function close() {
  window.clearTimeout(hide);
  recognition?.abort();
  recognition = undefined;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  open.value = false;
  typing.value = false;
  hearing.value = false;
  armedUntil = 0;
  window.clearTimeout(armTimer);
  unresolved = undefined;
  state.value = 'idle';
}
/** Die Antwort bleibt kurz stehen und macht dann von selbst Platz – außer jemand tippt gerade. */
function hideSoon() {
  window.clearTimeout(hide);
  if (!typing.value) hide = window.setTimeout(close, HIDE_AFTER_MS);
}

/**
 * Schickt den Satz an den Kern und zeigt die Antwort. Kam er über das Aktivierungswort und hat nichts
 * ausgelöst – nicht verstanden oder eine Rückfrage –, hört die Anzeige nach ihrer Antwort gleich weiter zu:
 * Wiederholen oder antworten geht dann ohne das Wort.
 */
async function send(text: string, spoken = false) {
  open.value = true;
  hearing.value = false;
  heard.value = text;
  state.value = 'thinking';
  trouble.value = '';
  const history = spoken && unresolved ? [unresolved] : [];
  unresolved = undefined;
  let again = false;
  try {
    const answer = await postJson<Answer>(`/p/${encodeURIComponent(source.value)}/ask`, { text, history });
    reply.value = answer.reply;
    // Eine Auskunft über einen Wert ist eine fertige Antwort, keine Rückfrage
    again = spoken && wake.value === 'on' && answer.actions.length === 0 && !answer.values?.length;
    if (again) unresolved = { text, reply: answer.reply };
    state.value = 'answer';
    hideSoon();
    speak(answer.reply, () => {
      // Nur wenn inzwischen nichts anderes begonnen hat
      if (again && state.value === 'answer' && unresolved?.text === text) arm(ECHO_MS, true);
    });
    return;
  } catch (cause) {
    reply.value = '';
    trouble.value = cause instanceof Error ? cause.message : String(cause);
  }
  state.value = 'answer';
  hideSoon();
}

function type(hint = '') {
  typing.value = true;
  trouble.value = hint;
  state.value = 'idle';
  window.clearTimeout(hide);
  void nextTick(() => field.value?.focus());
}
function sendTyped() {
  const text = typed.value.trim();
  if (!text || state.value === 'thinking') return;
  typed.value = '';
  void send(text);
}

function listen() {
  window.clearTimeout(hide);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  open.value = true;
  heard.value = '';
  reply.value = '';
  trouble.value = '';
  if (!ready.value) {
    trouble.value = t('voice.notReady');
    state.value = 'answer';
    return hideSoon();
  }
  if (!available) return type(t('voice.unavailable'));

  typing.value = false;
  const current = new available();
  recognition = current;
  current.lang = region.value;
  current.interimResults = true;
  current.continuous = false;
  let failed = '';
  current.onresult = (event) => {
    heard.value = Array.from(event.results, (result) => result[0]?.transcript ?? '').join('');
  };
  current.onerror = (event) => {
    failed = event.error;
  };
  current.onend = () => {
    if (recognition !== current) return;
    recognition = undefined;
    const text = heard.value.trim();
    if (text) return void send(text);
    // Ohne Mikrofon oder ohne Erlaubnis bleibt das Tippen
    if (failed === 'not-allowed' || failed === 'service-not-allowed') return type(t('voice.denied'));
    if (failed === 'audio-capture' || failed === 'network') return type(t('voice.unavailable'));
    trouble.value = t('voice.nothing');
    state.value = 'answer';
    hideSoon();
  };
  state.value = 'listening';
  try {
    current.start();
  } catch {
    recognition = undefined;
    type(t('voice.unavailable'));
  }
}

/** Antippen beginnt das Zuhören – und beendet es, wenn der Satz fertig ist. */
function tap() {
  // Ein Fingertipp ist auch die Gelegenheit, das Mithören nachzuholen – etwa nachdem das Mikrofon erlaubt wurde
  if (wakeWord.value && hasModel.value && wake.value === 'failed') void startWake();
  if (state.value === 'listening') recognition?.stop();
  else if (state.value !== 'thinking') listen();
}
onUnmounted(() => {
  close();
  wakeListener?.stop();
});
</script>

<template>
  <section class="voice">
    <button class="mic" :class="[state, { off: !ready }]" :aria-label="t(state === 'listening' ? 'voice.stop' : 'voice.start')" @click="tap">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6.5 9a6.5 6.5 0 0 0 13 0M12 18.5V21" /></svg>
      <span>{{ props.config.title ?? t('voice.title') }}</span>
      <span v-if="wakeWord && wake !== 'off'" class="wake" :class="wake">{{ wake === 'on' ? t('voice.say', { word: wakeWord }) : wake === 'loading' ? t('voice.wakeLoading') : t('voice.wakeFailed') }}</span>
    </button>

    <Teleport to="body">
      <div v-if="open" class="voice-panel" :class="[state, { listening: hearing }]" role="status" aria-live="polite">
        <svg class="sign" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6.5 9a6.5 6.5 0 0 0 13 0M12 18.5V21" /></svg>
        <div class="lines">
          <p v-if="state === 'listening' || (hearing && state !== 'thinking')" class="status">{{ t('voice.listening') }}</p>
          <p v-else-if="state === 'thinking'" class="status">{{ t('voice.thinking') }}</p>
          <p v-if="heard" class="heard">„{{ heard }}“</p>
          <p v-if="state === 'answer' && reply" class="reply">{{ reply }}</p>
          <p v-if="trouble" class="trouble">{{ trouble }}</p>
          <form v-if="typing" @submit.prevent="sendTyped">
            <input ref="field" v-model="typed" type="text" autocomplete="off" enterkeyhint="send" :placeholder="t('voice.example')" :disabled="state === 'thinking'" />
            <button type="submit" :disabled="state === 'thinking' || !typed.trim()">{{ t('voice.send') }}</button>
          </form>
        </div>
        <button class="type" :aria-label="t('voice.type')" @click="type()">⌨</button>
        <button class="shut" :aria-label="t('overlay.close')" @click="close">×</button>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.voice {
  container-type: size;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
  background: var(--card);
  overflow: hidden;
}
.mic {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--title-ink);
  font-size: clamp(12px, 14cqh, 16px);
  font-weight: 600;
}
.mic svg {
  width: clamp(26px, min(52cqh, 52cqw), 72px);
  height: clamp(26px, min(52cqh, 52cqw), 72px);
}
svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mic.off {
  color: var(--none);
}
/* Unter der Beschriftung steht, womit sich die Anzeige ansprechen lässt */
.wake {
  max-width: 100%;
  color: var(--mute);
  font-size: clamp(10px, 10cqh, 13px);
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wake.failed {
  color: var(--warn);
}
/* Während des Zuhörens trägt die Kachel die Akzentfarbe und pulsiert */
.mic.listening {
  background: var(--accent);
  color: var(--on-accent);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.7;
  }
}
/* In einer flachen Kachel steht die Beschriftung neben dem Zeichen */
@container (max-height: 70px) {
  .mic {
    flex-direction: row;
    gap: 8px;
  }
  .wake {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mic.listening {
    animation: none;
  }
}
</style>

<style>
/* Die Tafel mit dem Gehörten und der Antwort liegt über der Anzeige, unten in der Mitte */
.voice-panel {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 70;
  transform: translateX(-50%);
  box-sizing: border-box;
  width: min(760px, calc(100vw - 32px));
  padding: 18px 20px;
  border-radius: 18px;
  background: var(--card);
  color: var(--ink);
  box-shadow: 0 0 0 2px var(--accent), 0 12px 40px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.voice-panel .sign {
  flex: none;
  width: 44px;
  height: 44px;
  padding: 8px;
  border-radius: 50%;
  background: var(--soft);
  color: var(--accent);
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.voice-panel.listening .sign {
  background: var(--accent);
  color: var(--on-accent);
}
.voice-panel .lines {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.voice-panel p {
  margin: 0;
}
.voice-panel .status {
  color: var(--accent);
  font-weight: 600;
}
.voice-panel .heard {
  color: var(--mute);
  font-size: 18px;
}
.voice-panel .reply {
  font-size: 26px;
  line-height: 1.25;
}
.voice-panel .trouble {
  color: var(--alarm);
  font-size: 18px;
}
.voice-panel form {
  display: flex;
  gap: 8px;
}
.voice-panel input {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 8px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  color: var(--ink);
  font: inherit;
  font-size: 18px;
}
.voice-panel button {
  flex: none;
  min-width: 48px;
  min-height: 48px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--soft);
  color: var(--ink);
  font-size: 20px;
}
.voice-panel form button {
  background: var(--accent);
  color: var(--on-accent);
  font-size: 17px;
  font-weight: 500;
}
.voice-panel button:disabled {
  opacity: 0.4;
}
</style>
