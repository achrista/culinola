// The live demo: starts on a click – only then does it load anything from other sites –, is scaled to the
// width of the page, and receives the buttons below it.
const box = document.querySelector('[data-demo]');

function start() {
  let frame = box.querySelector('iframe');
  if (frame) return frame;
  frame = document.createElement('iframe');
  frame.src = box.dataset.src;
  frame.title = box.dataset.title;
  frame.allow = 'autoplay; microphone';
  box.replaceChildren(frame);
  const fit = () => (frame.style.transform = `scale(${box.clientWidth / 1920})`);
  new ResizeObserver(fit).observe(box);
  fit();
  frame.focus();
  return frame;
}

if (box) {
  box.querySelector('.demo-start').addEventListener('click', start);
  for (const button of document.querySelectorAll('[data-demo-send]')) {
    button.addEventListener('click', () => {
      const wanted = button.dataset.demoSend;
      const running = box.querySelector('iframe');
      const frame = start();
      const send = () => frame.contentWindow?.postMessage({ culinola: wanted }, location.origin);
      // A demo that is only just starting needs a moment before it listens
      if (running) send();
      else setTimeout(send, 4000);
    });
  }
}
