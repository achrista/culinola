import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Ein Platzhalter für die Claude-API, nur für Tests und die Testinstanz: Er nimmt Anfragen an
 * `/v1/messages` auf diesem Rechner entgegen und antwortet in der Form der echten Schnittstelle
 * mit einem festen Rezept. So läuft der ganze Weg vom Hochladen bis zur Rezeptdatei, ohne dass
 * eine Vorlage das Haus verlässt oder Kosten entstehen. Mit Sprachverständnis hat er nichts zu tun.
 */
export interface StandIn {
  /** Adresse für `ANTHROPIC_BASE_URL`. */
  url: string;
  /** Die Rümpfe der eingegangenen Anfragen, wie sie ankamen. */
  requests: StandInRequest[];
  close(): Promise<void>;
}

export interface StandInRequest {
  model: string;
  messages: { role: string; content: { type: string; text?: string }[] }[];
  [key: string]: unknown;
}

export async function startStandIn(port = 0): Promise<StandIn> {
  const requests: StandInRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json', 'request-id': `req_platzhalter_${requests.length}` });
        response.end(JSON.stringify(body));
      };
      if (request.method !== 'POST' || !request.url?.startsWith('/v1/messages')) return send(404, { type: 'error', error: { type: 'not_found_error', message: 'Der Platzhalter kennt nur /v1/messages.' } });
      const asked = JSON.parse(Buffer.concat(chunks).toString('utf8')) as StandInRequest;
      requests.push(asked);
      const blocks = asked.messages.flatMap((message) => message.content);
      const text = blocks.find((block) => block.type === 'text')?.text ?? '';
      // Der Titel kommt aus der ersten Zeile des Textes, sonst aus dem Namen der Vorlage
      const firstLine = /Text der Vorlage:\s*\n+\s*(.+)/.exec(text)?.[1];
      const name = /Name der Vorlage: (.+)/.exec(text)?.[1]?.replace(/\.\w+$/, '');
      if (/kein rezept/i.test(firstLine ?? '')) return send(200, message(asked.model, { recipes: [] }));
      const recipe = {
        title: (firstLine ?? name ?? 'Rezept').replace(/^#+\s*/, '').slice(0, 60),
        description: 'Vom Platzhalter der Testinstanz erzeugt, nicht von einem Sprachmodell.',
        category: 'Sonstiges',
        tags: ['Test'],
        time: '10 min',
        servings: '2',
        portions: 2,
        ingredients: [{ title: null, items: [{ quantity: '1', unit: 'Prise', name: 'Salz', note: null, iconKey: 'other' }] }],
        steps: [{ title: null, steps: ['Alles verrühren.'] }],
        notes: [],
        sourceUrl: null,
        // Liegt ein Bild bei, gilt das erste als Foto des Gerichts
        dishPhoto: blocks.some((block) => block.type === 'image') ? 1 : null,
      };
      send(200, message(asked.model, { recipes: [recipe] }));
    });
  });
  await new Promise<void>((ready) => server.listen(port, '127.0.0.1', ready));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function message(model: string, output: unknown) {
  return {
    id: 'msg_platzhalter',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: JSON.stringify(output) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}
