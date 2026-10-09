// Die Töne der Anzeige werden erzeugt, nicht abgespielt: keine Tondatei, keine fremden Rechte.

let context: AudioContext | undefined;

/**
 * Browser spielen Ton erst, nachdem die Seite einmal berührt wurde. Jede Berührung der
 * Anzeige schaltet ihn deshalb frei – danach können auch Töne erklingen, die niemand
 * gerade ausgelöst hat: das Klingeln der Eieruhr, der Hinweis auf einen Anruf.
 */
export function unlockSound(): void {
  context ??= new AudioContext();
  void context.resume();
}
window.addEventListener('pointerdown', unlockSound, { passive: true });

/** Ein Ton mit weichem Ein- und Ausklang, damit er nicht knackt. */
function tone(start: number, frequency: number, seconds: number, loudness: number): void {
  if (!context) return;
  const oscillator = context.createOscillator();
  const level = context.createGain();
  oscillator.frequency.value = frequency;
  level.gain.setValueAtTime(0, start);
  level.gain.linearRampToValueAtTime(loudness, start + 0.01);
  level.gain.setValueAtTime(loudness, start + seconds - 0.04);
  level.gain.linearRampToValueAtTime(0, start + seconds);
  oscillator.connect(level).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + seconds + 0.02);
}

function ready(): AudioContext | undefined {
  if (!context) unlockSound();
  return context?.state === 'running' ? context : undefined;
}

/** Kurze hohe Töne hintereinander: drei als Klingeln der Eieruhr, einer als Erinnerung. */
export function beep(count: number): void {
  const audio = ready();
  if (!audio) return;
  for (let index = 0; index < count; index++) tone(audio.currentTime + index * 0.22, 1320, 0.16, 0.5);
}

/** Türglocke: zwei volle Töne, der zweite tiefer – zweimal hintereinander. */
export function bell(): void {
  const audio = ready();
  if (!audio) return;
  for (const start of [0, 1.1]) {
    tone(audio.currentTime + start, 659.25, 0.45, 0.5);
    tone(audio.currentTime + start + 0.42, 523.25, 0.6, 0.5);
  }
}

/** Zwei aufsteigende Töne: Es tut sich etwas, ohne dass es eilt – etwa ein Anruf. */
export function chime(): void {
  const audio = ready();
  if (!audio) return;
  tone(audio.currentTime, 880, 0.18, 0.35);
  tone(audio.currentTime + 0.17, 1174.66, 0.3, 0.35);
}
