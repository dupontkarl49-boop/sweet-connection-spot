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

/** Découpe le texte en morceaux courts (certains navigateurs coupent au-delà de ~200 caractères). */
function chunkText(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?…\n]+[.!?…]*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if ((current + part).length > 180) {
      if (current) chunks.push(current.trim());
      current = part;
    } else {
      current += part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
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
      const synth = window.speechSynthesis;
      synth.cancel();
      // Certains navigateurs (mobile) restent en pause après un cancel().
      synth.resume();

      const voice = pickFrenchVoice();
      const chunks = chunkText(text);
      setCurrent(id);

      chunks.forEach((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = "fr-FR";
        if (voice) utterance.voice = voice;
        utterance.rate = 1;
        utterance.pitch = 1;
        if (index === chunks.length - 1) {
          utterance.onend = () => setCurrent(null);
        }
        utterance.onerror = () => setCurrent(null);
        utteranceRef.current = utterance;
        synth.speak(utterance);
      });

      // Workaround Chrome : la synthèse s'interrompt après ~15 s.
      const keepAlive = window.setInterval(() => {
        if (!synth.speaking) {
          window.clearInterval(keepAlive);
          return;
        }
        synth.pause();
        synth.resume();
      }, 10000);
    },
    [id, supported]
  );

  return { supported, isSpeaking: speakingId === id, speak, stop };
}
