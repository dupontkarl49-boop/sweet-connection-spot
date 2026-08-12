import { useCallback, useEffect, useRef, useState } from "react";

let currentId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function setCurrent(id: string | null) {
  currentId = id;
  listeners.forEach((l) => l(id));
}

function pickFrenchVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length) return null;
  return (
    voices.find((v) => /^fr[-_]FR/i.test(v.lang)) ??
    voices.find((v) => /^fr/i.test(v.lang)) ??
    null
  );
}

/** Lecture vocale (français) d'un texte, via la Web Speech API du navigateur. */
export function useSpeech(id: string) {
  const [speakingId, setSpeakingId] = useState<string | null>(currentId);
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    listeners.add(setSpeakingId);
    return () => {
      listeners.delete(setSpeakingId);
    };
  }, []);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setCurrent(null);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();

      const start = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "fr-FR";
        const voice = pickFrenchVoice();
        if (voice) utterance.voice = voice;
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.onend = () => setCurrent(null);
        utterance.onerror = () => setCurrent(null);
        utteranceRef.current = utterance;
        setCurrent(id);
        window.speechSynthesis.speak(utterance);
      };

      // Les voix peuvent être chargées de façon asynchrone.
      if (!window.speechSynthesis.getVoices().length) {
        const handler = () => {
          window.speechSynthesis.onvoiceschanged = null;
          start();
        };
        window.speechSynthesis.onvoiceschanged = handler;
        setTimeout(() => {
          if (window.speechSynthesis.onvoiceschanged === handler) handler();
        }, 300);
      } else {
        start();
      }
    },
    [id, supported]
  );

  return { supported, isSpeaking: speakingId === id, speak, stop };
}
