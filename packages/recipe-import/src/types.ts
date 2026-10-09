/** Warengruppen der Merkio-Einkaufsliste; die Kennungen stammen aus dem Merkio-Backend. */
export const SHOPPING_ICON_KEYS = [
  'fruit_veg',
  'meat_fish',
  'drinks',
  'dairy',
  'frozen',
  'bakery',
  'sweets',
  'household',
  'drugstore',
  'other',
] as const;

export type ShoppingIconKey = (typeof SHOPPING_ICON_KEYS)[number];

export interface Ingredient {
  /** Menge als Zahl mit Punkt ("250", "0.5") oder Spanne ("1-2"); ohne Mengenangabe null. */
  quantity: string | null;
  /** Einheit, so kurz wie im Rezept üblich: g, ml, EL, TL, Prise, Päckchen … */
  unit: string | null;
  name: string;
  /** Zusatz zur Zutat, etwa "zimmerwarm", "ca." oder "Größe M". */
  note: string | null;
  iconKey: ShoppingIconKey;
}

export interface IngredientGroup {
  /** Überschrift eines Abschnitts wie "Für den Teig"; null, wenn das Rezept die Zutaten nicht gliedert. */
  title: string | null;
  items: Ingredient[];
}

export interface StepGroup {
  title: string | null;
  steps: string[];
}

/** Woher ein Rezept stammt. */
export interface RecipeSource {
  /** Vermerk zur Herkunft, etwa "Familienrezept" oder "Instagram". */
  label?: string;
  /** Webadresse des Originals. */
  url?: string;
  /** Name der Datei, aus der das Rezept gelesen wurde. */
  file?: string;
}

/**
 * Ein Rezept in der gemeinsamen Form für Culinola und Merkio. Culinola zeigt das daraus
 * erzeugte Markdown, Merkio nutzt zusätzlich die gegliederten Zutaten für die Einkaufsliste.
 */
export interface Recipe {
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  /** Zeitangabe, so wie sie im Rezept steht, etwa "45 min". */
  time: string | null;
  /** Portionen, so wie sie im Rezept stehen, etwa "4" oder "1 Blech". */
  servings: string | null;
  /** Anzahl der Portionen als Zahl, wenn das Rezept eine nennt – Grundlage für das Umrechnen. */
  portions: number | null;
  ingredients: IngredientGroup[];
  steps: StepGroup[];
  notes: string[];
  source: RecipeSource;
  /** Bild des Rezepts: Dateiname neben der Rezeptdatei oder Webadresse. */
  image?: string;
}

/** Ein Bild, das der Quelle beilag – als Titelbild oder als abfotografierter Rezepttext. */
export interface SourceImage {
  name: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  data: Uint8Array;
}

/** Was aus einer Quelle gelesen wurde, bevor das Sprachmodell es deutet. */
export interface SourceMaterial {
  /** Dateiname oder Webadresse – dient dem Modell als Anhaltspunkt für den Titel. */
  name: string;
  /** Lesbarer Text der Quelle; fehlt bei Scans und Fotos. */
  text?: string;
  /** Ein PDF, das das Modell selbst liest – auch gescannte Seiten ohne Textebene. */
  pdf?: Uint8Array;
  /** Bilder aus der Quelle; das Modell sieht sie und benennt das Foto des fertigen Gerichts. */
  images: SourceImage[];
  /** Webadresse der Quelle, wenn sie aus dem Netz stammt. */
  url?: string;
  /** Titelbild als Webadresse, etwa aus den Angaben einer Rezeptseite. */
  imageUrl?: string;
  /**
   * Foto des Gerichts, das zur Quelle gehört, ohne in ihr zu stecken: das Titelbild einer
   * Webseite oder eine Bilddatei gleichen Namens neben der Vorlage. Das Modell bekommt es nicht zu sehen.
   */
  cover?: SourceImage;
  /** Hinweise für den Aufrufer, etwa auf gekürzten Text. */
  warnings: string[];
}
