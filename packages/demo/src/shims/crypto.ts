// Das Wenige aus `node:crypto`, das Kern und Plugins in der Demo brauchen. Die Prüfsumme dient nur als
// Stand eines Layouts, nicht der Sicherheit – deshalb genügt ein schneller Hash statt SHA-256.

function hash(text: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  let c = 0x2545f491;
  let d = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
    c = Math.imul(c ^ code, 2246822507);
    d = Math.imul(d ^ code, 3266489909);
  }
  const mix = (x: number, y: number) => (Math.imul(x ^ (x >>> 16), 2246822507) ^ Math.imul(y ^ (y >>> 13), 3266489909)) >>> 0;
  return [mix(a, b), mix(b, c), mix(c, d), mix(d, a)].map((part) => part.toString(16).padStart(8, '0')).join('');
}

export function createHash(_algorithm: string) {
  let text = '';
  const digest = {
    update(part: string) {
      text += part;
      return digest;
    },
    digest: () => hash(text),
  };
  return digest;
}

class Bytes extends Uint8Array {
  override toString(encoding?: string): string {
    if (encoding === 'hex') return [...this].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const base64 = btoa(String.fromCharCode(...this));
    return encoding === 'base64url' ? base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : base64;
  }
}

export function randomBytes(size: number): Bytes {
  return crypto.getRandomValues(new Bytes(size));
}

export function randomInt(min: number, max?: number): number {
  const [low, high] = max === undefined ? [0, min] : [min, max];
  return low + Math.floor(Math.random() * (high - low));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export default { createHash, randomBytes, randomInt, timingSafeEqual };
