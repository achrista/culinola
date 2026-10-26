// `node:path` für den Browser: Pfade wie auf einem Unix-System, mit "/" als Wurzel des Dateisystems im Arbeitsspeicher.

export const sep = '/';

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/');
}

export function resolve(...paths: string[]): string {
  let joined = '';
  for (const path of paths) joined = isAbsolute(path) ? path : `${joined}/${path}`;
  return normalize(joined);
}

export function join(...paths: string[]): string {
  const joined = paths.filter(Boolean).join('/');
  return isAbsolute(joined) ? normalize(joined) : normalize(joined).slice(1) || '.';
}

export function dirname(path: string): string {
  const full = normalize(path);
  const slash = full.lastIndexOf('/');
  return slash <= 0 ? '/' : full.slice(0, slash);
}

export function basename(path: string, extension?: string): string {
  const name = path.split('/').filter(Boolean).pop() ?? '';
  return extension && name.endsWith(extension) && name !== extension ? name.slice(0, -extension.length) : name;
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

export function relative(from: string, to: string): string {
  const source = resolve(from).split('/').filter(Boolean);
  const target = resolve(to).split('/').filter(Boolean);
  let shared = 0;
  while (shared < source.length && shared < target.length && source[shared] === target[shared]) shared++;
  return [...source.slice(shared).map(() => '..'), ...target.slice(shared)].join('/');
}

export const posix = { sep, isAbsolute, resolve, join, dirname, basename, extname, relative };
export default { ...posix, posix };
