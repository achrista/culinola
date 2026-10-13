<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiError, getJson, postJson, rememberToken } from './api.ts';

/**
 * Diese Anzeige hat keinen Zugang. Statt ein Token in die Adresse zu setzen, bittet sie um einen und zeigt
 * dazu einen kurzen Code: Wer einrichten darf, bestätigt ihn in den Einstellungen – an einem anderen Gerät –
 * und wählt, was die Anzeige darf. Das Token kommt danach von selbst hier an.
 */
const props = defineProps<{
  /** Das Layout, das diese Anzeige zeigen will – steht in der Anfrage, damit man sie erkennt. */
  layout: string;
  /** Warum der Kern abgelehnt hat. */
  reason: string;
}>();

interface Asked {
  id: string;
  secret: string;
}
type State = { state: 'waiting'; code: string } | { state: 'approved'; token: string } | { state: 'rejected' } | { state: 'expired' };

const KEY = 'culinola.pairing';
const POLL_MS = 2_500;
const { t } = useI18n();
const code = ref('');
const mode = ref<'starting' | 'waiting' | 'rejected' | 'unavailable' | 'busy'>('starting');
const trouble = ref('');
let asked: Asked | undefined;
let timer: number | undefined;

const settingsAddress = computed(() => `${location.origin}/?edit=settings`);
const shownCode = computed(() => code.value.replace(/^(\d{3})(\d{3})$/, '$1 $2'));

/** Woran man die Anfrage in den Einstellungen erkennt: Browser, Betriebssystem und das gewünschte Layout. */
function label(): string {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
  const system = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Mac OS X/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
  return [browser, system, props.layout].filter(Boolean).join(' · ');
}

// Die Anfrage übersteht ein Neuladen der Seite: So bleibt der Code derselbe, den man schon abgelesen hat
function remembered(): Asked | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Asked | null;
    return saved && typeof saved.id === 'string' && typeof saved.secret === 'string' ? saved : undefined;
  } catch {
    return undefined;
  }
}
function remember(next: Asked | undefined): void {
  asked = next;
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Ohne Speicher gilt die Anfrage bis zum Neuladen.
  }
}

async function ask(): Promise<void> {
  const created = await postJson<Asked & { code: string }>('/pairing', { label: label() });
  remember({ id: created.id, secret: created.secret });
  code.value = created.code;
  mode.value = 'waiting';
}

async function check(): Promise<void> {
  try {
    // Ohne laufende Anfrage wird eine gestellt; danach fragt die Anzeige in kurzen Abständen nach
    const answer: State = asked ? await postJson<State>(`/pairing/${encodeURIComponent(asked.id)}`, { secret: asked.secret }) : { state: 'expired' };
    if (answer.state === 'waiting') {
      code.value = answer.code;
      mode.value = 'waiting';
    } else if (answer.state === 'approved') {
      remember(undefined);
      rememberToken(answer.token);
      // Mit dem Zugang lädt die Anzeige, was sie zeigen wollte
      location.reload();
      return;
    } else if (answer.state === 'rejected') {
      remember(undefined);
      mode.value = 'rejected';
      return;
    } else {
      // Abgelaufen: Die Anzeige fragt von selbst neu an – sie soll auch nach Stunden noch gekoppelt werden können
      remember(undefined);
      await ask();
    }
    trouble.value = '';
  } catch (cause) {
    // Zu viele offene Anfragen oder der Kern ist gerade nicht da: später noch einmal
    if (cause instanceof ApiError && cause.status === 429) mode.value = 'busy';
    trouble.value = cause instanceof Error ? cause.message : String(cause);
  }
  timer = window.setTimeout(() => void check(), POLL_MS);
}

function again(): void {
  mode.value = 'starting';
  void check();
}

onMounted(async () => {
  try {
    const setup = await getJson<{ pairing?: boolean }>('/setup');
    if (!setup.pairing) {
      mode.value = 'unavailable';
      return;
    }
  } catch {
    mode.value = 'unavailable';
    return;
  }
  asked = remembered();
  void check();
});
onUnmounted(() => window.clearTimeout(timer));
</script>

<template>
  <main class="pairing">
    <h1>{{ t('pairing.title') }}</h1>
    <template v-if="mode === 'unavailable'">
      <p>{{ t('app.notUnlocked', { error: reason }) }}</p>
    </template>
    <template v-else-if="mode === 'rejected'">
      <p>{{ t('pairing.rejected') }}</p>
      <button type="button" @click="again">{{ t('pairing.again') }}</button>
    </template>
    <template v-else>
      <p class="code" role="status" :aria-label="t('pairing.codeLabel', { code: shownCode })">{{ shownCode || '··· ···' }}</p>
      <p>{{ t('pairing.how') }}</p>
      <p class="address">{{ settingsAddress }}</p>
      <p class="small">{{ t('pairing.then') }}</p>
      <p v-if="mode === 'busy'" class="small bad" role="alert">{{ trouble }}</p>
    </template>
    <p class="links">
      <a :href="settingsAddress">{{ t('pairing.here') }}</a>
    </p>
    <details>
      <summary>{{ t('pairing.other') }}</summary>
      <p>{{ t('pairing.otherText') }}</p>
    </details>
  </main>
</template>

<style scoped>
.pairing {
  box-sizing: border-box;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  color: var(--bg-ink);
  overflow-y: auto;
}
h1 {
  margin: 0;
  font-size: clamp(20px, 3vw, 34px);
  font-weight: 600;
}
p {
  margin: 4px 0;
  max-width: 44em;
  font-size: clamp(15px, 1.6vw, 22px);
  line-height: 1.4;
}
/* Der Code ist das, was man quer durch den Raum ablesen können muss */
.code {
  margin: 12px 0;
  padding: 8px 28px;
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  font-size: clamp(48px, 11vw, 150px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
}
.address {
  font-family: ui-monospace, Consolas, monospace;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.small,
details {
  font-size: clamp(13px, 1.2vw, 17px);
  opacity: 0.85;
}
.bad {
  color: var(--alarm);
  opacity: 1;
}
.links {
  margin-top: 14px;
}
a {
  color: inherit;
}
button {
  min-height: 44px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-weight: 600;
}
details {
  max-width: 44em;
  margin-top: 6px;
}
summary {
  cursor: pointer;
}
</style>
