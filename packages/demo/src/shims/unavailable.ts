// Was in der Demo nicht mitgeliefert wird – etwa das Umwandeln neuer Rezepte mit einem Sprachmodell.
// Wer es aufruft, bekommt eine verständliche Meldung statt eines fehlenden Moduls.

const message = 'In der Demo lassen sich keine neuen Rezepte umwandeln – dafür braucht es eine eigene Installation mit Schlüssel der Claude-API.';

export async function convertRecipe(): Promise<never> {
  throw new Error(message);
}

export function explainError(): { reason: string; message: string } {
  return { reason: 'unavailable', message };
}

export function saveRecipe(): never {
  throw new Error(message);
}
