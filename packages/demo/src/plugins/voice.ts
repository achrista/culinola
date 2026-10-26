import type { PluginContext } from '@culinola/sdk';
import { language } from '../language.ts';

/**
 * Sprachsteuerung der Demo. Die echte fragt ein Sprachmodell; die Demo versteht nur ein paar feste Sätze –
 * genug, um zu zeigen, wie ein gesprochener Satz die Eieruhr stellt, das Licht schaltet oder das Radio startet.
 */

interface Done {
  action: string;
  params: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

const NUMBERS: Record<string, number> = { eine: 1, einen: 1, ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwölf: 12, fünfzehn: 15, zwanzig: 20, dreißig: 30, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20 };
const HELP_DE = 'In der Demo verstehe ich nur einfache Sätze – zum Beispiel „Eieruhr fünf Minuten“, „Licht Esstisch aus“, „Spiel Bayern 3“, „Radio aus“, „Wie warm ist es draußen?“ oder „Milch auf die Einkaufsliste“.';
const HELP_EN = 'In the demo I only understand simple sentences – for example “timer five minutes”, “dining table light off”, “play Bayern 3”, “radio off”, “how warm is it outside?” or “milk on the shopping list”.';

export function startVoice(context: PluginContext<unknown>): void {
  context.datapoints.set({ id: 'ready', value: true, label: 'Sprachsteuerung eingerichtet' });
  context.datapoints.set({ id: 'model', value: false, label: 'Sprachmodell für das Aktivierungswort vorhanden' });

  context.routes.post('/ask', async (request) => {
    const said = String((request.body as { text?: unknown } | null)?.text ?? '').trim();
    if (!said) return Response.json({ error: 'Es fehlt der Satz ("text").' }, { status: 400 });
    const text = said.toLowerCase();
    const english = language === 'en';
    const actions: Done[] = [];
    const values: string[] = [];
    const run = async (action: string, params: Record<string, unknown>) => {
      try {
        await context.actions.run(action, params);
        actions.push({ action, params, ok: true });
        return true;
      } catch (error) {
        actions.push({ action, params, ok: false, error: error instanceof Error ? error.message : String(error) });
        return false;
      }
    };
    const answer = (reply: string) => Response.json({ reply, actions, values });
    const value = (id: string) => context.datapoints.list().find((datapoint) => datapoint.id === id)?.value;
    const amount = (/(\d+(?:[.,]\d+)?)/.exec(text)?.[1]?.replace(',', '.') ?? Object.entries(NUMBERS).find(([word]) => new RegExp(`\\b${word}\\b`).test(text))?.[1]) as string | number | undefined;

    if (/eieruhr|wecker|timer|minute/.test(text) && !/stop|aus\b|off/.test(text)) {
      const count = Number(amount ?? 5);
      const seconds = /sekunde|second/.test(text);
      await run('timer.start', seconds ? { seconds: count } : { minutes: count });
      return answer(english ? `Timer set for ${count} ${seconds ? 'seconds' : 'minutes'}.` : `Die Eieruhr läuft: ${count} ${seconds ? 'Sekunden' : count === 1 ? 'Minute' : 'Minuten'}.`);
    }
    if (/eieruhr|timer|stoppuhr|stopwatch/.test(text)) {
      if (/stoppuhr|stopwatch/.test(text) && !/stop\b|aus\b|off/.test(text)) {
        await run('timer.stopwatch', {});
        return answer(english ? 'Stopwatch started.' : 'Die Stoppuhr läuft.');
      }
      await run('timer.stop', {});
      return answer(english ? 'Timer stopped.' : 'Die Eieruhr ist aus.');
    }
    if (/radio|musik|music|spiel|play|bayern|antenne|rock|rt1/.test(text)) {
      if (/\b(aus|stopp?|off|leise aus)\b/.test(text)) {
        await run('radio.stop', {});
        return answer(english ? 'Radio off.' : 'Das Radio ist aus.');
      }
      if (/lauter|louder/.test(text) || /leiser|quieter/.test(text)) {
        await run('radio.volume', { delta: /lauter|louder/.test(text) ? 10 : -10 });
        return answer(english ? 'Done.' : 'Erledigt.');
      }
      const station = [['bayern 3', 'bayern3'], ['bayern drei', 'bayern3'], ['bayern 2', 'bayern2'], ['bayern zwei', 'bayern2'], ['rock', 'rock'], ['rt1', 'hit-rt1'], ['rt 1', 'hit-rt1'], ['antenne', 'antenne']].find(([name]) => text.includes(name!))?.[1] ?? 'bayern3';
      await run('radio.play', { station });
      return answer(english ? 'Here you go.' : 'Gern, das Radio läuft.');
    }
    if (/markise|awning/.test(text)) {
      const out = /raus|aus\b|ausfahren|out|down|runter/.test(text);
      await run('cover.move', { datapoint: 'openhab:Terrassendach', direction: out ? 'down' : 'up' });
      return answer(english ? (out ? 'Extending the awning.' : 'Retracting the awning.') : out ? 'Die Markise fährt aus.' : 'Die Markise fährt ein.');
    }
    if (/licht|lampe|leuchte|light|lamp/.test(text)) {
      const shown = context.datapoints.shown().filter((entry) => context.datapoints.list().some((datapoint) => datapoint.id === entry.id && datapoint.writable && typeof datapoint.value === 'boolean'));
      const target = shown.find((entry) => entry.name && text.includes(entry.name.toLowerCase())) ?? shown[0];
      if (!target) return answer(english ? HELP_EN : HELP_DE);
      const on = !/\b(aus|off|ausschalten)\b/.test(text);
      await run('switch.set', { datapoint: target.id, on });
      return answer(english ? `${target.name} is ${on ? 'on' : 'off'}.` : `${target.name} ist ${on ? 'an' : 'aus'}.`);
    }
    if (/einkauf|shopping|liste|list/.test(text)) {
      const item = said.replace(/\b(bitte|setze?|schreib\w*|auf die|auf|zur|zu der|die|einkaufsliste|einkaufszettel|liste|put|add|on|to|the|shopping list|please)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      if (!item) return answer(english ? HELP_EN : HELP_DE);
      await run('lists.add', { text: item });
      return answer(english ? `${item} is on the shopping list.` : `${item} steht auf der Einkaufsliste.`);
    }
    if (/warm|kalt|temperatur|grad|cold|temperature|degrees/.test(text)) {
      const outside = /draußen|außen|outside/.test(text);
      const id = outside ? 'openhab:WS_Temperature' : 'openhab:Mess_TWohnen';
      const reading = value(id);
      values.push(outside ? 'Außen' : 'Wohnen');
      const degrees = typeof reading === 'number' ? reading.toLocaleString(english ? 'en-GB' : 'de-DE', { maximumFractionDigits: 1 }) : '?';
      return answer(english ? `It is ${degrees} degrees ${outside ? 'outside' : 'in the living room'}.` : `${outside ? 'Draußen' : 'Im Wohnzimmer'} hat es ${degrees} Grad.`);
    }
    return answer(english ? HELP_EN : HELP_DE);
  });
}
