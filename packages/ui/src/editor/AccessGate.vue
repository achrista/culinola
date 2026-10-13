<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { accessToken, getJson, postJson, rememberSession } from '../api.ts';

/**
 * Wer einrichten will, weist sich hier aus: mit dem Einrichtungskennwort – oder, wo noch keines festgelegt ist,
 * mit dem Token eines Zugangs, der einrichten darf. Wer beides nicht (mehr) hat, fordert einen Einrichtungscode
 * an; der Kern legt ihn in den Datenordner, und mit ihm lässt sich ein neues Kennwort festlegen.
 */
const { t } = useI18n();
const setup = ref<{ protected: boolean; password: boolean }>();
/** Als was diese Seite schon freigeschaltet ist – etwa als Anzeige, die nur bedienen darf. */
const known = ref<{ name: string; role: string }>();
const login = reactive({ password: '', token: '', said: '', busy: false });
const reset = reactive({ open: false, asked: false, file: '', minutes: 0, code: '', password: '', repeat: '', said: '', busy: false });

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

onMounted(async () => {
  try {
    setup.value = await getJson('/setup');
  } catch (cause) {
    login.said = message(cause);
    setup.value = { protected: true, password: false };
  }
  if (accessToken()) known.value = await getJson<{ name: string; role: string }>('/access').catch(() => undefined);
});

/** Merkt sich die Anmeldung und öffnet die Seite, die eigentlich gemeint war. */
function enter(token: string): void {
  rememberSession(token);
  location.reload();
}

async function withPassword(): Promise<void> {
  if (login.busy) return;
  Object.assign(login, { busy: true, said: '' });
  try {
    enter((await postJson<{ token: string }>('/login', { password: login.password })).token);
  } catch (cause) {
    login.said = message(cause);
  } finally {
    login.busy = false;
  }
}

/** Ohne Kennwort: das Token eines Zugangs, der einrichten darf – geprüft, bevor es gemerkt wird. */
async function withToken(): Promise<void> {
  if (login.busy) return;
  Object.assign(login, { busy: true, said: '' });
  try {
    const token = login.token.trim();
    const response = await fetch('/api/v1/access', { headers: { Authorization: `Bearer ${token}` } });
    const access = (await response.json().catch(() => ({}))) as { role?: string; name?: string; error?: string };
    if (!response.ok) login.said = access.error ?? t('gate.tokenWrong');
    else if (access.role !== 'admin') login.said = t('gate.tokenTooLow', { name: access.name ?? '' });
    else enter(token);
  } catch (cause) {
    login.said = message(cause);
  } finally {
    login.busy = false;
  }
}

async function askForCode(): Promise<void> {
  if (reset.busy) return;
  Object.assign(reset, { busy: true, said: '' });
  try {
    const answer = await postJson<{ file: string; minutes: number }>('/reset', {});
    Object.assign(reset, { asked: true, file: answer.file, minutes: answer.minutes });
  } catch (cause) {
    reset.said = message(cause);
  } finally {
    reset.busy = false;
  }
}

async function setNewPassword(): Promise<void> {
  if (reset.busy) return;
  if (reset.password !== reset.repeat) {
    reset.said = t('gate.mismatch');
    return;
  }
  Object.assign(reset, { busy: true, said: '' });
  try {
    enter((await postJson<{ token: string }>('/reset/password', { code: reset.code, password: reset.password })).token);
  } catch (cause) {
    reset.said = message(cause);
  } finally {
    reset.busy = false;
  }
}

function leave(): void {
  const query = new URLSearchParams(location.search);
  query.delete('edit');
  location.search = query.toString();
}
</script>

<template>
  <main v-if="setup" class="gate">
    <section>
      <h1>{{ t('gate.title') }}</h1>
      <p v-if="known" class="hint">{{ t('gate.knownAs', { name: known.name, role: t(`system.roles.${known.role}`) }) }}</p>

      <form v-if="setup.password" @submit.prevent="withPassword">
        <p>{{ t('gate.intro') }}</p>
        <label>
          {{ t('gate.password') }}
          <input v-model="login.password" type="password" required autocomplete="current-password" autofocus />
        </label>
        <button type="submit" class="primary" :disabled="login.busy || !login.password">{{ t('gate.login') }}</button>
      </form>
      <form v-else @submit.prevent="withToken">
        <p>{{ t('gate.noPassword') }}</p>
        <label>
          {{ t('gate.token') }}
          <input v-model="login.token" type="password" required autocomplete="off" spellcheck="false" />
        </label>
        <button type="submit" class="primary" :disabled="login.busy || !login.token.trim()">{{ t('gate.login') }}</button>
      </form>
      <p v-if="login.said" class="said bad" role="alert">{{ login.said }}</p>

      <details class="help" :open="reset.open" @toggle="reset.open = ($event.target as HTMLDetailsElement).open">
        <summary>{{ t(setup.password ? 'gate.forgot' : 'gate.noAccess') }}</summary>
        <p>{{ t('gate.resetIntro') }}</p>
        <button v-if="!reset.asked" type="button" :disabled="reset.busy" @click="askForCode">{{ t('gate.askCode') }}</button>
        <form v-else @submit.prevent="setNewPassword">
          <p>
            <strong>{{ t('gate.codeWhere', { file: reset.file, minutes: reset.minutes }) }}</strong>
          </p>
          <p class="small">{{ t('gate.codeFolder') }}</p>
          <label>
            {{ t('gate.code') }}
            <input v-model="reset.code" type="text" required inputmode="numeric" autocomplete="one-time-code" placeholder="1234-5678" />
          </label>
          <label>
            {{ t('gate.newPassword') }}
            <input v-model="reset.password" type="password" required minlength="8" autocomplete="new-password" />
          </label>
          <label>
            {{ t('gate.repeat') }}
            <input v-model="reset.repeat" type="password" required minlength="8" autocomplete="new-password" />
          </label>
          <button type="submit" class="primary" :disabled="reset.busy">{{ t('gate.setPassword') }}</button>
        </form>
        <p v-if="reset.said" class="said bad" role="alert">{{ reset.said }}</p>
      </details>

      <details class="help">
        <summary>{{ t('gate.help') }}</summary>
        <p v-for="(paragraph, index) in t('gate.helpText').split('\n')" :key="index">{{ paragraph }}</p>
      </details>

      <p class="leave">
        <button type="button" @click="leave">{{ t('gate.leave') }}</button>
      </p>
    </section>
  </main>
</template>

<style scoped>
.gate {
  box-sizing: border-box;
  height: 100%;
  padding: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  background: var(--soft);
}
section {
  width: 100%;
  max-width: 520px;
  margin-top: min(8vh, 80px);
  padding: 18px 20px 20px;
  border-radius: 8px;
  background: var(--card);
  color: var(--ink);
}
h1 {
  margin: 0 0 8px;
  font-size: 22px;
}
p {
  margin: 8px 0;
  line-height: 1.4;
}
form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--mute);
  font-size: 14px;
}
button,
input {
  font: inherit;
  color: var(--ink);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px;
}
button {
  min-height: 44px;
  align-self: flex-start;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.hint,
.small {
  color: var(--mute);
}
.small {
  font-size: 14px;
}
.said {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--soft);
}
.bad {
  color: var(--alarm);
}
.help {
  margin: 14px 0 0;
  padding: 8px 12px;
  border-radius: 6px;
  border-left: 4px solid var(--accent);
  background: var(--soft);
}
.help summary {
  cursor: pointer;
  font-weight: 600;
}
.leave {
  margin: 16px 0 0;
}
</style>
