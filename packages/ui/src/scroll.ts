import type { Directive } from 'vue';

/** So lange nach der letzten Bewegung bleibt eine Liste verschoben, bevor sie an den Anfang zurückkehrt. */
const HOME_AFTER_MS = 60_000;
const cleanups = new WeakMap<HTMLElement, () => void>();

/**
 * Macht eine Liste, die länger ist als ihre Kachel, mit dem Finger verschiebbar – und
 * holt sie von selbst an den Anfang zurück. Eine Anzeige an der Wand soll nicht stundenlang
 * mitten in einer Liste stehen bleiben, nur weil jemand einmal geblättert hat.
 */
export const vScrollHome: Directive<HTMLElement> = {
  mounted(element) {
    element.classList.add('scroll-list');
    let timer: number | undefined;
    const onScroll = () => {
      window.clearTimeout(timer);
      // Sanft zurück, solange jemand zusieht; eine verdeckte Seite zeichnet nicht, dort springt die Liste
      if (element.scrollTop > 0) timer = window.setTimeout(() => element.scrollTo({ top: 0, behavior: document.hidden ? 'auto' : 'smooth' }), HOME_AFTER_MS);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    cleanups.set(element, () => {
      window.clearTimeout(timer);
      element.removeEventListener('scroll', onScroll);
    });
  },
  unmounted(element) {
    cleanups.get(element)?.();
    cleanups.delete(element);
  },
};
