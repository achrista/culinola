# recipe-import

In Culinola it sits behind "+ Recipe" in the recipe view (plugin [`recipes`](../../README.md#adding-new-recipes)) and behind `npm run recipes:import` for whole folders. Merkio uses it for its list type "Recipes": the backend keeps a bundled copy (`backend/vendor/recipe-import.cjs`, generated with `npm run vendor:recipe-import` in the Merkio backend).

Converts recipes from arbitrary sources into Culinola's recipe format and into a structured form for Merkio's planned recipe extension. Reading and organizing is done by Claude Haiku.

| Source | How it is read |
|---|---|
| PDF | goes to the model unchanged – including scans without a text layer; embedded photos are extracted |
| Word (`.docx`), LibreOffice (`.odt`) | text including tables, plus the images they contain |
| Word old (`.doc`) | text; files from before Word 97 as a makeshift |
| Text, Markdown, HTML | text |
| Image (`.jpg`, `.png`, `.webp`, `.gif`) | the model reads the photographed recipe |
| Web address | preferably the page's machine-readable data (schema.org/Recipe), otherwise its running text; no access to addresses in your own network |

### The photo of the dish

A recipe gets its photo from the first source that yields one:

1. **From the source** – images in Word and LibreOffice files, embedded JPEG photos in PDFs, the image itself for an image source. The model sees them and says which one shows the finished dish; preparation photos, logos and scanned text are thereby ruled out.
2. **The web page's cover image** (`image` in the recipe details, otherwise `og:image`). It is fetched and stored with the recipe – the addresses of such images often only last hours.
3. **An image next to the source** with the same name: `Apfelkuchen.pdf` and `Apfelkuchen.jpg`. In a folder run, such an image is not a source of its own. When integrating, the setting `photo` next to `data` corresponds to this.

Limits: from old Word (`.doc`) and from PDFs with images packaged differently, no photo comes out; way 3 helps here. Images for the model may be 5 MB, cover image and accompanying image 15 MB.

## Result

Two files are produced per recipe:

- **Culinola:** `culinola/<category>/<title>.md` – header details and Markdown following the model of [`pfannkuchen.md`](../../plugins/recipes/examples/pfannkuchen.md), plus the photo of the dish under the same name, named as `image` in the header details. The folder can be used unchanged as the recipe folder of the `recipes` plugin. With `--recipes <folder>`, recipe and photo land directly in the recipe folder instead – nothing is overwritten and nothing is deleted there; if the name already exists, the new recipe gets a number.
- **Merkio:** `merkio/<id>.json` – the same recipe structured (`Recipe` in [src/types.ts](src/types.ts)): ingredients with quantity, unit, name and product group (`iconKey` as in Merkio's shopping list), steps, notes, origin and the finished Markdown.

The note on origin (`--label`) appears as a keyword in `tags`, in the header details as `source` – this is how Culinola's recipe list shows it – and in the JSON under `source.label`.

## Usage

Requirement: a key for the Claude API. It is looked for as the environment variable `ANTHROPIC_API_KEY`, in a file `.env` in the folder of the call (`ANTHROPIC_API_KEY=…`) and where the plugin also reads it: in `data/secrets.json` as `{ "recipes": { "anthropicApiKey": "…" } }`. The calls apply in Culinola's main folder.

```bash
npm run recipes:import -- ./sources --label "Family recipe" --recipes data/recipes
```

```bash
npm run recipes:import -- https://example.org/rezepte/brandteig --out output
```

A folder is read without its subfolders (`--recursive` includes them). `--dry-run` only reads the sources and does not call the model. What has been converted is recorded in `output/protokoll.json`; a second run skips unchanged sources and only catches up on what failed (`--force` converts everything anew). All options: `npm run recipes:import -- --help`.

## Integration

```ts
import { convertRecipe, toShoppingItems } from '@culinola/recipe-import';

const { recipes } = await convertRecipe({ url: 'https://…' }, { label: 'Web' });
// also: { file: 'rezept.pdf' } · { data: bytes, name: 'upload.docx', mediaType } · { text: '…' }

for (const converted of recipes) {
  const { recipe, markdown, photo } = converted;
  // recipe   – structured form (Merkio)
  // markdown – file for the recipe folder (Culinola)
  // photo    – photo of the dish: from the source, otherwise cover image or accompanying image
  toShoppingItems(recipe, 6); // ingredients for 6 servings as shopping-list entries
  saveRecipe('data/recipes', converted); // stores <category>/<title>.md including photo, without overwriting anything
}
```

If the conversion fails, `explainError(error)` classifies the error – missing access, API unreachable, empty source, unusable response – and returns a sentence for the user.

- **Culinola** runs without compiling; `exports` points to `src/index.ts`.
- **Merkio backend** (CommonJS): `npm run build -w @culinola/recipe-import` generates `dist/`; it is included with `await import('…/dist/index.js')`. The existing client can be passed in: `convertRecipe(input, { client })`.

The model is `claude-haiku-5-5` (option `model`), the output language `de`, `en` or `fr` (option `language`), the categories are predefined and replaceable (option `categories`).

The tests do not call the model. Where the whole path up to the recipe file is tested – in the `recipes` plugin and in the test instance –, a stand-in on your own computer ([src/standin.ts](src/standin.ts)) answers with a fixed recipe in the shape of the Claude API.
