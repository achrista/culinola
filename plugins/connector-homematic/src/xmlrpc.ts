/**
 * XML-RPC, soweit eine Homematic-Zentrale es spricht: Aufrufe und Antworten schreiben und lesen.
 * Bewusst selbst geschrieben – das Format ist klein, und so kommt kein fremdes Paket ins Haus.
 */

/** Ein Wert, wie er über XML-RPC reist. Ganze Zahlen und Kommazahlen sind dort verschieden. */
export type RpcValue = string | number | boolean | RpcValue[] | { [key: string]: RpcValue };

/** Erzwingt beim Schreiben eine Kommazahl (`<double>`) – die Zentrale unterscheidet 1 und 1.0. */
export class RpcDouble {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
}

/** Die Zentrale meldet einen Fehler: unbekanntes Gerät, unzulässiger Wert. */
export class RpcFault extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function write(value: RpcValue | RpcDouble): string {
  if (value instanceof RpcDouble) return `<value><double>${value.value}</double></value>`;
  if (typeof value === 'boolean') return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
  if (typeof value === 'number') return Number.isInteger(value) ? `<value><i4>${value}</i4></value>` : `<value><double>${value}</double></value>`;
  if (typeof value === 'string') return `<value><string>${escape(value)}</string></value>`;
  if (Array.isArray(value)) return `<value><array><data>${value.map(write).join('')}</data></array></value>`;
  return `<value><struct>${Object.entries(value)
    .map(([name, entry]) => `<member><name>${escape(name)}</name>${write(entry)}</member>`)
    .join('')}</struct></value>`;
}

export function encodeCall(method: string, params: (RpcValue | RpcDouble)[] = []): string {
  return `<?xml version="1.0"?><methodCall><methodName>${escape(method)}</methodName><params>${params.map((param) => `<param>${write(param)}</param>`).join('')}</params></methodCall>`;
}

export function encodeResponse(value: RpcValue): string {
  return `<?xml version="1.0"?><methodResponse><params><param>${write(value)}</param></params></methodResponse>`;
}

export function encodeFault(code: number, message: string): string {
  return `<?xml version="1.0"?><methodResponse><fault>${write({ faultCode: code, faultString: message })}</fault></methodResponse>`;
}

/** Bytes zu Text: Die Zentrale schreibt in ISO-8859-1 und sagt das in der ersten Zeile; ohne Angabe gilt UTF-8. */
export function decodeBytes(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, 100)).toString('latin1');
  return Buffer.from(bytes).toString(/encoding=["']iso-8859-1["']/i.test(head) ? 'latin1' : 'utf8');
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescape = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => (name[0] === '#' ? String.fromCodePoint(name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))) : (ENTITIES[name.toLowerCase()] ?? whole)));

/** Liest das XML Stück für Stück; es gibt nur Elemente und Text, keine Attribute von Belang. */
class Reader {
  private at = 0;
  private readonly xml: string;
  constructor(xml: string) {
    this.xml = xml;
    // Die erste Zeile mit der Angabe der Zeichenkodierung gehört nicht zum Inhalt
    const declaration = /^\s*<\?xml[^>]*\?>/.exec(xml);
    if (declaration) this.at = declaration[0].length;
  }

  private skip(): void {
    while (this.at < this.xml.length && /\s/.test(this.xml[this.at]!)) this.at++;
  }

  /** Sieht nach, welches Element als Nächstes beginnt, ohne es zu verbrauchen. */
  peek(): string | undefined {
    this.skip();
    return /^<([a-zA-Z0-9_.]+)\s*\/?>/.exec(this.xml.slice(this.at, this.at + 60))?.[1];
  }

  open(name: string): void {
    this.skip();
    const tag = `<${name}>`;
    if (!this.xml.startsWith(tag, this.at)) throw new Error(`XML-RPC: <${name}> erwartet bei Zeichen ${this.at}.`);
    this.at += tag.length;
  }

  /** Öffnet ein Element, wenn es als Nächstes kommt; ein leeres (`<name/>`) zählt als geöffnet und geschlossen. */
  tryOpen(name: string): 'open' | 'empty' | undefined {
    this.skip();
    if (this.xml.startsWith(`<${name}/>`, this.at)) {
      this.at += name.length + 3;
      return 'empty';
    }
    if (!this.xml.startsWith(`<${name}>`, this.at)) return undefined;
    this.at += name.length + 2;
    return 'open';
  }

  close(name: string): void {
    this.skip();
    const tag = `</${name}>`;
    if (!this.xml.startsWith(tag, this.at)) throw new Error(`XML-RPC: </${name}> erwartet bei Zeichen ${this.at}.`);
    this.at += tag.length;
  }

  /** Der Text bis zum nächsten Element. */
  text(): string {
    const end = this.xml.indexOf('<', this.at);
    const raw = this.xml.slice(this.at, end < 0 ? this.xml.length : end);
    this.at += raw.length;
    return unescape(raw);
  }

  value(): RpcValue {
    this.open('value');
    const kind = this.peek();
    let result: RpcValue;
    if (!kind) {
      // Ohne Angabe der Art ist es Text – so schreibt die Zentrale ihre Zeichenketten
      result = this.text();
    } else if (kind === 'struct') {
      const struct: Record<string, RpcValue> = {};
      if (this.tryOpen('struct') === 'open') {
        while (this.tryOpen('member')) {
          this.open('name');
          const name = this.text();
          this.close('name');
          struct[name] = this.value();
          this.close('member');
        }
        this.close('struct');
      }
      result = struct;
    } else if (kind === 'array') {
      const list: RpcValue[] = [];
      this.open('array');
      if (this.tryOpen('data') === 'open') {
        while (this.peek() === 'value') list.push(this.value());
        this.close('data');
      }
      this.close('array');
      result = list;
    } else {
      const state = this.tryOpen(kind);
      const text = state === 'open' ? this.text() : '';
      if (state === 'open') this.close(kind);
      if (kind === 'boolean') result = text.trim() === '1' || text.trim().toLowerCase() === 'true';
      else if (kind === 'i4' || kind === 'int' || kind === 'i8' || kind === 'double') result = Number(text.trim());
      else result = text;
      if (typeof result === 'number' && !Number.isFinite(result)) throw new Error(`XML-RPC: "${text}" ist keine Zahl.`);
    }
    this.close('value');
    return result;
  }
}

/** Liest die Antwort auf einen Aufruf; ein gemeldeter Fehler wird zur Ausnahme. */
export function decodeResponse(xml: string): RpcValue {
  const reader = new Reader(xml);
  reader.open('methodResponse');
  if (reader.tryOpen('fault')) {
    const fault = reader.value() as { faultCode?: number; faultString?: string };
    throw new RpcFault(Number(fault.faultCode ?? 0), String(fault.faultString ?? 'Unbekannter Fehler'));
  }
  // Manche Antworten sind leer: kein Wert heißt „erledigt“
  if (reader.tryOpen('params') !== 'open') return '';
  if (reader.tryOpen('param') !== 'open') return '';
  return reader.value();
}

/** Liest einen Aufruf, wie ihn die Zentrale an Culinola richtet, um Änderungen zu melden. */
export function decodeCall(xml: string): { method: string; params: RpcValue[] } {
  const reader = new Reader(xml);
  reader.open('methodCall');
  reader.open('methodName');
  const method = reader.text().trim();
  reader.close('methodName');
  const params: RpcValue[] = [];
  if (reader.tryOpen('params') === 'open') {
    while (reader.tryOpen('param')) {
      params.push(reader.value());
      reader.close('param');
    }
  }
  return { method, params };
}
