/**
 * Zuhören auf ein Aktivierungswort – ganz auf dem Gerät. Ein kleines Sprachmodell (Vosk) läuft im
 * Browser und setzt das Gehörte in Text um; das Mikrofonsignal verlässt den Rechner dabei nicht.
 * Erst der Satz nach dem Aktivierungswort geht als Text an den Kern.
 */

/** Was nach dem Aktivierungswort gesagt wurde – oder dass es gar nicht fiel. */
export interface Heard {
  /** Ob das Aktivierungswort vorkam. */
  woke: boolean;
  /** Der Satz dahinter; leer, wenn nur das Wort fiel. */
  command: string;
}

/**
 * Sucht das Aktivierungswort in einem erkannten Satz und gibt zurück, was danach kommt.
 * Fällt es mehrmals, gilt das letzte – „Computer … ach nein, Computer, Radio aus“.
 */
export function afterWakeWord(text: string, word: string): Heard {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = word.toLowerCase().split(/\s+/).filter(Boolean);
  if (!wanted.length) return { woke: false, command: '' };
  let found = -1;
  for (let at = 0; at + wanted.length <= words.length; at++) {
    if (wanted.every((part, offset) => words[at + offset] === part)) found = at;
  }
  if (found < 0) return { woke: false, command: '' };
  return { woke: true, command: words.slice(found + wanted.length).join(' ') };
}

export interface WakeOptions {
  /** Adresse des Sprachmodells als gepacktes Archiv. */
  modelUrl: string;
  /** Laufend, während jemand spricht: der Text, soweit er schon erkannt ist. */
  onPartial(text: string): void;
  /** Wenn eine Äußerung zu Ende ist: der erkannte Text. */
  onFinal(text: string): void;
}

export interface WakeListener {
  stop(): void;
}

/**
 * Öffnet das Mikrofon und lässt das Sprachmodell mithören. Wirft, wenn der Browser kein Mikrofon
 * hergibt – ohne gesicherte Verbindung oder ohne Erlaubnis – oder das Modell sich nicht laden lässt.
 */
export async function listenForSpeech(options: WakeOptions): Promise<WakeListener> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('microphone-unavailable');
  // Das Modell und die Erkennung werden erst geladen, wenn eine Anzeige mithören soll
  const { createModel } = await import('vosk-browser');
  const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  let model: Awaited<ReturnType<typeof createModel>> | undefined;
  let audio: AudioContext | undefined;
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
    void audio?.close().catch(() => undefined);
    model?.terminate();
  };
  try {
    model = await createModel(options.modelUrl);
    audio = new AudioContext();
    const recognizer = new model.KaldiRecognizer(audio.sampleRate);
    recognizer.on('partialresult', (message) => {
      const text = (message as { result?: { partial?: string } }).result?.partial;
      if (text) options.onPartial(text);
    });
    recognizer.on('result', (message) => {
      const text = (message as { result?: { text?: string } }).result?.text;
      if (text) options.onFinal(text);
    });
    const source = audio.createMediaStreamSource(stream);
    // Reicht das Mikrofonsignal in kleinen Stücken an die Erkennung; der Ausgang bleibt stumm
    const feed = audio.createScriptProcessor(4096, 1, 1);
    feed.onaudioprocess = (event) => {
      try {
        recognizer.acceptWaveform(event.inputBuffer);
      } catch {
        // Ein verlorenes Stück Ton ist kein Grund, das Zuhören zu beenden.
      }
    };
    const silent = audio.createGain();
    silent.gain.value = 0;
    source.connect(feed).connect(silent).connect(audio.destination);
    return {
      stop: () => {
        feed.onaudioprocess = null;
        recognizer.remove();
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
