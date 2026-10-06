import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};
const MAX_BYTES = 2_000_000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

/** Dateiendung zu einem gemeldeten Bildtyp; unbekannte Typen werden nicht gespeichert. */
export function extensionFor(contentType: string | null): string | undefined {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return Object.entries(TYPES).find(([, value]) => value === type)?.[0];
}

export function contentTypeFor(file: string): string | undefined {
  return TYPES[extname(file).toLowerCase()];
}

export interface Logo {
  file: string;
  contentType: string;
}

/**
 * Senderlogos liegen als Dateien im Ordner des Plugins. Angegeben wird je Sender
 * entweder eine Adresse – dann holt der Kern das Bild einmal und bewahrt es auf –
 * oder der Name einer Datei, die man selbst in den Ordner gelegt hat.
 *
 * Das Aufbewahren hat drei Gründe: Die Anzeige braucht keinen fremden Server, die
 * Logos sind auch ohne Internet da, und eine später tote Adresse lässt das Bild nicht verschwinden.
 */
export class LogoStore {
  private readonly dir: string;

  constructor(storageDir: string) {
    this.dir = join(storageDir, 'logos');
    mkdirSync(this.dir, { recursive: true });
  }

  /** Das vorhandene Logo eines Senders, falls eines da ist. */
  find(stationId: string): Logo | undefined {
    const file = readdirSync(this.dir).find((name) => basename(name, extname(name)) === stationId && contentTypeFor(name));
    return file ? { file: join(this.dir, file), contentType: contentTypeFor(file)! } : undefined;
  }

  /** Eine selbst abgelegte Datei; der Name darf keinen Pfad enthalten. */
  local(name: string): Logo | undefined {
    const file = join(this.dir, basename(name));
    const contentType = contentTypeFor(file);
    return contentType && existsSync(file) ? { file, contentType } : undefined;
  }

  read(logo: Logo): Buffer {
    return readFileSync(logo.file);
  }

  /** Holt ein Logo, wenn noch keines da ist oder das vorhandene alt ist. Gibt eine Fehlermeldung zurück, sonst nichts. */
  async fetch(stationId: string, url: string, signal: AbortSignal): Promise<string | undefined> {
    const existing = this.find(stationId);
    if (existing && Date.now() - statSync(existing.file).mtimeMs < REFRESH_MS) return undefined;
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Culinola' }, signal });
      if (!response.ok) return `Adresse antwortet mit ${response.status}`;
      const extension = extensionFor(response.headers.get('content-type'));
      if (!extension) return `kein Bild (${response.headers.get('content-type') ?? 'Typ unbekannt'})`;
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > MAX_BYTES) return 'Bild ist größer als 2 MB';
      writeFileSync(join(this.dir, stationId + extension), data);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
