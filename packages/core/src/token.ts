// Erzeugt ein zufälliges Zugangstoken zum Eintragen in secrets.json: `npm run token`
import { randomBytes } from 'node:crypto';

console.log(randomBytes(32).toString('base64url'));
