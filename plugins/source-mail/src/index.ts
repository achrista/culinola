import { definePlugin } from '@culinola/sdk';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { type Address, hasAttachments, loginOf, type MailEntry, newestFirst, senderOf, type StructureNode } from './mail.ts';
import { readableMessage } from './message.ts';

interface Account {
  id: string;
  name: string;
  /** Server und Anmeldename; fehlen sie hier, stehen sie bei den Geheimnissen. */
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  folder: string;
}

interface Config {
  accounts: Account[];
  /** So viele der neuesten Nachrichten werden je Konto geholt. */
  perAccount: number;
  refreshMinutes: number;
  /** Bilder aus dem Netz in HTML-Nachrichten nachladen. Ohne die Angabe bleiben sie weg, weil Absender daran das Öffnen bemerken. */
  remoteImages: boolean;
}

const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]*$/;
/** Größere Nachrichten werden nicht zur Anzeige geholt – meist sind es Anlagen, und die zeigt Culinola ohnehin nicht. */
const MAX_BYTES = 15_000_000;
const KEEP_OPENED = 20;

/**
 * E-Mails aus IMAP-Postfächern. Das Plugin liest nur: Es öffnet die Postfächer ohne
 * Schreibrecht, markiert nichts als gelesen und verschiebt nichts.
 */
export default definePlugin<Config>({
  id: 'source-mail',

  parseConfig(raw) {
    const config = raw as { accounts?: unknown; perAccount?: unknown; refreshMinutes?: unknown; remoteImages?: unknown };
    if (!Array.isArray(config.accounts) || config.accounts.length === 0) throw new Error('"accounts" fehlt oder ist leer.');
    const accounts = (config.accounts as Partial<Account>[]).map((entry) => {
      if (!ACCOUNT_ID.test(entry.id ?? '')) throw new Error(`Konto "${entry.name ?? '?'}": "id" fehlt oder enthält anderes als Kleinbuchstaben, Ziffern und Bindestriche.`);
      const port = entry.port ?? 993;
      return { id: entry.id!, name: entry.name ?? entry.id!, ...(entry.host ? { host: entry.host } : {}), port, secure: entry.secure ?? port === 993, ...(entry.user ? { user: entry.user } : {}), folder: entry.folder ?? 'INBOX' };
    });
    if (new Set(accounts.map((account) => account.id)).size !== accounts.length) throw new Error('Eine Konto-Kennung ist doppelt vergeben.');
    const number = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' ? Math.min(max, Math.max(min, value)) : fallback);
    return { accounts, perAccount: number(config.perAccount, 30, 1, 200), refreshMinutes: number(config.refreshMinutes, 5, 1, 1440), remoteImages: config.remoteImages === true };
  },

  start(context) {
    const { config, log } = context;
    const lists = new Map<string, MailEntry[]>();
    const trouble = new Map<string, string>();
    const opened = new Map<string, unknown>();

    /** Verbindet sich mit einem Postfach, erledigt eine Aufgabe und meldet sich wieder ab. */
    async function withMailbox<T>(account: Account, task: (client: ImapFlow) => Promise<T>): Promise<T> {
      const login = loginOf(account, (name) => context.secrets.get(name), context.instanceId);
      const client = new ImapFlow({ host: login.host, port: account.port, secure: account.secure, auth: { user: login.user, pass: login.password }, logger: false, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 60_000 });
      // Ohne diesen Empfänger würde ein Abbruch der Verbindung den ganzen Kern beenden
      client.on('error', () => undefined);
      await client.connect();
      try {
        // Nur lesend geöffnet: Der Server ändert dabei keine Kennzeichen, auch nicht „ungelesen“
        const lock = await client.getMailboxLock(account.folder, { readOnly: true });
        try {
          return await task(client);
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    }

    async function readList(account: Account): Promise<MailEntry[]> {
      return withMailbox(account, async (client) => {
        const total = typeof client.mailbox === 'object' ? client.mailbox.exists : 0;
        if (!total) return [];
        const entries: MailEntry[] = [];
        for await (const message of client.fetch(`${Math.max(1, total - config.perAccount + 1)}:*`, { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, size: true })) {
          const received = message.internalDate ?? message.envelope?.date;
          entries.push({
            account: account.id,
            uid: message.uid,
            from: senderOf(message.envelope?.from as Address[] | undefined),
            subject: message.envelope?.subject?.trim() ?? '',
            date: received ? new Date(received).toISOString() : new Date(0).toISOString(),
            unread: !message.flags?.has('\\Seen'),
            attachments: hasAttachments(message.bodyStructure as StructureNode | undefined),
            size: message.size ?? 0,
          });
        }
        return entries;
      });
    }

    const publish = () => {
      const all = newestFirst([...lists.values()].flat(), config.accounts.length * config.perAccount);
      context.resources.set('messages', all);
      context.resources.set(
        'accounts',
        config.accounts.map((account) => ({ id: account.id, name: account.name, ...(trouble.has(account.id) ? { error: trouble.get(account.id) } : {}) })),
      );
      context.datapoints.set({ id: 'unread', value: all.filter((entry) => entry.unread).length, label: 'Ungelesene Nachrichten' });
      // Die Anzeige erfährt über diesen Datenpunkt, dass es Neues zu holen gibt
      context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Letzter Abruf der Postfächer' });
    };

    const refresh = async () => {
      await Promise.all(
        config.accounts.map(async (account) => {
          try {
            lists.set(account.id, await readList(account));
            if (trouble.delete(account.id)) log.info(`Postfach "${account.name}" ist wieder erreichbar.`);
          } catch (error) {
            if (context.signal.aborted) return;
            const message = error instanceof Error ? error.message : String(error);
            // Die zuletzt geholten Nachrichten bleiben stehen; gemeldet wird eine Störung einmal.
            if (trouble.get(account.id) !== message) log.warn(`Postfach "${account.name}" nicht abrufbar: ${message}`);
            trouble.set(account.id, message);
          }
        }),
      );
      publish();
    };

    publish();
    void refresh().then(() => log.info(`${config.accounts.length} Postfächer abgerufen: ${config.accounts.map((account) => `${account.name} (${trouble.has(account.id) ? 'Störung' : (lists.get(account.id)?.length ?? 0)})`).join(', ')}`));
    const timer = setInterval(() => void refresh(), config.refreshMinutes * 60_000);
    context.signal.addEventListener('abort', () => clearInterval(timer));

    // Eine einzelne Nachricht zum Lesen: Kopfangaben, Text und die Namen der Anlagen – nicht die Anlagen selbst.
    context.routes.get('/message/:account/:uid', async (request) => {
      const account = config.accounts.find((entry) => entry.id === request.params.account);
      const uid = Number(request.params.uid);
      if (!account || !Number.isInteger(uid) || uid < 1) return Response.json({ error: 'Nachricht nicht gefunden.' }, { status: 404 });
      const key = `${account.id}:${uid}`;
      if (opened.has(key)) return Response.json(opened.get(key));

      const listed = lists.get(account.id)?.find((entry) => entry.uid === uid);
      if (listed && listed.size > MAX_BYTES) return Response.json({ error: 'Die Nachricht ist zu groß, um sie hier zu zeigen.' }, { status: 413 });
      try {
        const source = await withMailbox(account, async (client) => {
          const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
          return message ? message.source : undefined;
        });
        if (!source) return Response.json({ error: 'Die Nachricht gibt es im Postfach nicht mehr.' }, { status: 404 });
        const result = { account: account.id, uid, ...readableMessage(await simpleParser(source), listed?.date ?? new Date().toISOString(), config.remoteImages) };
        opened.set(key, result);
        if (opened.size > KEEP_OPENED) opened.delete(opened.keys().next().value!);
        return Response.json(result);
      } catch (error) {
        log.warn(`Nachricht aus "${account.name}" nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
        return Response.json({ error: 'Die Nachricht ließ sich nicht aus dem Postfach holen.' }, { status: 502 });
      }
    });
  },
});
