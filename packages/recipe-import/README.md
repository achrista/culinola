# recipe-import

In Culinola steckt es hinter „+ Rezept“ in der Rezeptansicht (Plugin [`recipes`](../../README.md#neue-rezepte-hinzufügen)) und hinter `npm run recipes:import` für ganze Ordner. Der Einbau in Merkio steht aus.

Wandelt Rezepte aus beliebigen Vorlagen in das Rezeptformat von Culinola und in eine gegliederte Form für die geplante Rezept-Erweiterung von Merkio um. Das Lesen und Ordnen übernimmt Claude Haiku.

| Vorlage | Wie sie gelesen wird |
|---|---|
| PDF | geht unverändert an das Modell – auch Scans ohne Textebene; eingebettete Fotos werden herausgelöst |
| Word (`.docx`), LibreOffice (`.odt`) | Text samt Tabellen, dazu die enthaltenen Bilder |
| Word alt (`.doc`) | Text; Dateien vor Word 97 behelfsmäßig |
| Text, Markdown, HTML | Text |
| Bild (`.jpg`, `.png`, `.webp`, `.gif`) | das Modell liest das abfotografierte Rezept |
| Webadresse | bevorzugt die maschinenlesbaren Angaben der Seite (schema.org/Recipe), sonst ihr Fließtext; kein Zugriff auf Adressen im eigenen Netz |

### Das Foto des Gerichts

Ein Rezept bekommt sein Foto aus der ersten Quelle, die eines hergibt:

1. **Aus der Vorlage** – Bilder in Word- und LibreOffice-Dateien, eingebettete JPEG-Fotos in PDFs, das Bild selbst bei einer Bildvorlage. Das Modell sieht sie und sagt, welches das fertige Gericht zeigt; Zubereitungsfotos, Logos und eingescannter Text scheiden so aus.
2. **Das Titelbild der Webseite** (`image` in den Rezeptangaben, sonst `og:image`). Es wird geholt und beim Rezept abgelegt – die Adressen solcher Bilder gelten oft nur Stunden.
3. **Ein Bild neben der Vorlage** mit demselben Namen: `Apfelkuchen.pdf` und `Apfelkuchen.jpg`. Im Ordnerlauf ist so ein Bild keine eigene Vorlage. Beim Einbau entspricht dem die Angabe `photo` neben `data`.

Grenzen: Aus altem Word (`.doc`) und aus PDFs mit anders verpackten Bildern kommt kein Foto heraus; hier hilft Weg 3. Bilder für das Modell dürfen 5 MB groß sein, Titelbild und Beibild 15 MB.

## Ergebnis

Je Rezept entstehen zwei Dateien:

- **Culinola:** `culinola/<Kategorie>/<Titel>.md` – Kopfdaten und Markdown nach dem Vorbild [`pfannkuchen.md`](../../plugins/recipes/examples/pfannkuchen.md), dazu das Foto des Gerichts unter demselben Namen, in den Kopfdaten als `image` genannt. Der Ordner lässt sich unverändert als Rezeptordner des Plugins `recipes` verwenden. Mit `--recipes <Ordner>` landen Rezept und Foto stattdessen gleich im Rezeptordner – dort wird nichts überschrieben und nichts gelöscht; gibt es den Namen schon, bekommt das neue Rezept eine Nummer.
- **Merkio:** `merkio/<kennung>.json` – dasselbe Rezept gegliedert (`Recipe` in [src/types.ts](src/types.ts)): Zutaten mit Menge, Einheit, Name und Warengruppe (`iconKey` wie in Merkios Einkaufsliste), Schritte, Hinweise, Herkunft und das fertige Markdown.

Der Vermerk zur Herkunft (`--label`) steht als Stichwort in `tags` und im JSON unter `source.label`.

## Aufruf

Voraussetzung: ein Schlüssel für die Claude-API. Gesucht wird er als Umgebungsvariable `ANTHROPIC_API_KEY`, in einer Datei `.env` im Ordner des Aufrufs (`ANTHROPIC_API_KEY=…`) und dort, wo ihn auch das Plugin liest: in `data/secrets.json` als `{ "recipes": { "anthropicApiKey": "…" } }`. Die Aufrufe gelten im Hauptordner von Culinola.

```bash
npm run recipes:import -- ./vorlagen --label Familienrezept --recipes data/recipes
```

```bash
npm run recipes:import -- https://example.org/rezepte/brandteig --out ausgabe
```

Ein Ordner wird ohne seine Unterordner gelesen (`--recursive` nimmt sie mit). `--dry-run` liest nur die Vorlagen und ruft das Modell nicht auf. Was umgewandelt ist, steht in `ausgabe/protokoll.json`; ein zweiter Lauf überspringt unveränderte Vorlagen und holt nur Fehlgeschlagenes nach (`--force` wandelt alles neu um). Alle Optionen: `npm run recipes:import -- --help`.

## Einbau

```ts
import { convertRecipe, toShoppingItems } from '@culinola/recipe-import';

const { recipes } = await convertRecipe({ url: 'https://…' }, { label: 'Web' });
// auch: { file: 'rezept.pdf' } · { data: bytes, name: 'upload.docx', mediaType } · { text: '…' }

for (const converted of recipes) {
  const { recipe, markdown, photo } = converted;
  // recipe   – gegliederte Form (Merkio)
  // markdown – Datei für den Rezeptordner (Culinola)
  // photo    – Foto des Gerichts: aus der Vorlage, sonst Titelbild oder Beibild
  toShoppingItems(recipe, 6); // Zutaten für 6 Portionen als Einträge der Einkaufsliste
  saveRecipe('data/recipes', converted); // legt <Kategorie>/<Titel>.md samt Foto ab, ohne etwas zu überschreiben
}
```

Scheitert die Umwandlung, ordnet `explainError(error)` den Fehler ein – fehlender Zugang, API nicht erreichbar, leere Vorlage, unbrauchbare Antwort – und liefert einen Satz für den Nutzer.

- **Culinola** läuft ohne Übersetzen; `exports` zeigt auf `src/index.ts`.
- **Merkio-Backend** (CommonJS): `npm run build -w @culinola/recipe-import` erzeugt `dist/`; eingebunden mit `await import('…/dist/index.js')`. Der vorhandene Client lässt sich übergeben: `convertRecipe(input, { client })`.

Das Modell ist `claude-haiku-5-5` (Option `model`), die Ausgabesprache `de`, `en` oder `fr` (Option `language`), die Kategorien sind vorgegeben und austauschbar (Option `categories`).

Die Tests rufen das Modell nicht auf. Wo der ganze Weg bis zur Rezeptdatei geprüft wird – im Plugin `recipes` und in der Testinstanz –, antwortet ein Platzhalter auf dem eigenen Rechner ([src/standin.ts](src/standin.ts)) in der Form der Claude-API mit einem festen Rezept.
