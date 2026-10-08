# recipe-import

> **Vorläufig abgelegt.** Das Paket ist eigenständig lauffähig, aber noch nicht in Culinola eingebunden: Kein Plugin und keine Oberfläche ruft es auf. Der Einbau – zuerst hier, danach in Merkio – steht aus.

Wandelt Rezepte aus beliebigen Vorlagen in das Rezeptformat von Culinola und in eine gegliederte Form für die geplante Rezept-Erweiterung von Merkio um. Das Lesen und Ordnen übernimmt Claude Haiku.

| Vorlage | Wie sie gelesen wird |
|---|---|
| PDF | geht unverändert an das Modell – auch Scans ohne Textebene; eingebettete Fotos werden herausgelöst |
| Word (`.docx`), LibreOffice (`.odt`) | Text samt Tabellen, dazu die enthaltenen Bilder |
| Word alt (`.doc`) | Text; Dateien vor Word 97 behelfsmäßig |
| Text, Markdown, HTML | Text |
| Bild (`.jpg`, `.png`, `.webp`, `.gif`) | das Modell liest das abfotografierte Rezept |
| Webadresse | bevorzugt die maschinenlesbaren Angaben der Seite (schema.org/Recipe), sonst ihr Fließtext; kein Zugriff auf Adressen im eigenen Netz |

## Ergebnis

Je Rezept entstehen zwei Dateien:

- **Culinola:** `culinola/<Kategorie>/<Titel>.md` – Kopfdaten und Markdown nach dem Vorbild [`pfannkuchen.md`](../../plugins/recipes/examples/pfannkuchen.md), dazu das Foto des Gerichts, wenn die Vorlage eines enthält. Der Ordner lässt sich unverändert als Rezeptordner des Plugins `recipes` verwenden.
- **Merkio:** `merkio/<kennung>.json` – dasselbe Rezept gegliedert (`Recipe` in [src/types.ts](src/types.ts)): Zutaten mit Menge, Einheit, Name und Warengruppe (`iconKey` wie in Merkios Einkaufsliste), Schritte, Hinweise, Herkunft und das fertige Markdown.

Der Vermerk zur Herkunft (`--label`) steht als Stichwort in `tags` und im JSON unter `source.label`.

## Aufruf

Voraussetzung: ein Schlüssel für die Claude-API – als Umgebungsvariable `ANTHROPIC_API_KEY` oder in einer Datei `.env` im Ordner des Aufrufs (`ANTHROPIC_API_KEY=…`). Die Aufrufe gelten im Ordner `packages/recipe-import`.

```bash
node src/cli.ts ./vorlagen --label Familienrezept --out ausgabe
```

```bash
node src/cli.ts https://example.org/rezepte/brandteig --out ausgabe
```

Ein Ordner wird ohne seine Unterordner gelesen (`--recursive` nimmt sie mit). `--dry-run` liest nur die Vorlagen und ruft das Modell nicht auf. Was umgewandelt ist, steht in `ausgabe/protokoll.json`; ein zweiter Lauf überspringt unveränderte Vorlagen und holt nur Fehlgeschlagenes nach (`--force` wandelt alles neu um). Alle Optionen: `node src/cli.ts --help`.

## Einbau

```ts
import { convertRecipe, toShoppingItems } from '@culinola/recipe-import';

const { recipes } = await convertRecipe({ url: 'https://…' }, { label: 'Web' });
// auch: { file: 'rezept.pdf' } · { data: bytes, name: 'upload.docx', mediaType } · { text: '…' }

for (const { recipe, markdown, photo } of recipes) {
  // recipe   – gegliederte Form (Merkio)
  // markdown – Datei für den Rezeptordner (Culinola)
  // photo    – Foto des Gerichts aus der Vorlage, falls vorhanden
  toShoppingItems(recipe, 6); // Zutaten für 6 Portionen als Einträge der Einkaufsliste
}
```

- **Culinola** läuft ohne Übersetzen; `exports` zeigt auf `src/index.ts`.
- **Merkio-Backend** (CommonJS): `npm run build -w @culinola/recipe-import` erzeugt `dist/`; eingebunden mit `await import('…/dist/index.js')`. Der vorhandene Client lässt sich übergeben: `convertRecipe(input, { client })`.

Das Modell ist `claude-haiku-5-5` (Option `model`), die Ausgabesprache `de`, `en` oder `fr` (Option `language`), die Kategorien sind vorgegeben und austauschbar (Option `categories`).

Die Tests rufen das Modell nicht auf; die Umwandlung selbst ist bisher nicht mit dem Modell erprobt.
