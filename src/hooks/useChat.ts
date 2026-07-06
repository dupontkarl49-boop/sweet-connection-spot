import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Message = {
  role: "user" | "assistant";
  content: string;
  image?: string;
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const LEGACY_HISTORY_KEY = "sigma_chat_history";

const normalizeMessage = (value: unknown): Message | null => {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<Message>;
  if (message.role !== "user" && message.role !== "assistant") return null;
  return {
    role: message.role,
    content: typeof message.content === "string" ? message.content : "",
    image: typeof message.image === "string" ? message.image : undefined,
  };
};

const loadLegacyHistory = (): Message[] => {
  try {
    const raw = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeMessage).filter((msg): msg is Message => Boolean(msg));
  } catch (error) {
    console.error("Failed to read legacy history:", error);
    return [];
  }
};

export function useChat(userId: string | undefined) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const { toast } = useToast();

  // Load messages from database when user changes
  useEffect(() => {
    if (!userId) {
      setMessages([]);
      setIsHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setIsHistoryLoading(true);
    supabase
      .from("messages")
      .select("role, content, image")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load history:", error);
        } else if (data) {
          const cloudMessages = data.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
            image: m.image ?? undefined,
          }));
          const legacyMessages = loadLegacyHistory();
          const migrationKey = `${LEGACY_HISTORY_KEY}_migrated_${userId}`;
          const shouldMigrateLegacy = legacyMessages.length > 0 && !localStorage.getItem(migrationKey);

          if (shouldMigrateLegacy) {
            const { error: migrationError } = await supabase.from("messages").insert(
              legacyMessages.map((msg) => ({
                user_id: userId,
                role: msg.role,
                content: msg.content,
                image: msg.image ?? null,
              }))
            );

            if (migrationError) {
              console.error("Failed to migrate legacy history:", migrationError);
            } else {
              localStorage.setItem(migrationKey, "true");
            }
          }

          setMessages(shouldMigrateLegacy ? [...legacyMessages, ...cloudMessages] : cloudMessages);
        }
        setIsHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persistMessage = useCallback(
    async (msg: Message) => {
      if (!userId) return;
      const { error } = await supabase.from("messages").insert({
        user_id: userId,
        role: msg.role,
        content: msg.content,
        image: msg.image ?? null,
      });
      if (error) console.error("Failed to save message:", error);
    },
    [userId]
  );

  const sendMessage = useCallback(async (input: string, imageBase64?: string) => {
    if (!userId) return;
    const userMessage: Message = { role: "user", content: input, image: imageBase64 };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    persistMessage(userMessage);

    let assistantContent = "";

    const updateAssistant = (chunk: string) => {
      assistantContent += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantContent } : m
          );
        }
        return [...prev, { role: "assistant", content: assistantContent }];
      });
    };

    try {
      // Build messages for API - convert to multimodal format if images present
      const apiMessages = [...messages, userMessage].map((msg) => {
        if (msg.image) {
          return {
            role: msg.role,
            content: [
              ...(msg.content ? [{ type: "text", text: msg.content }] : []),
              {
                type: "image_url",
                image_url: { url: msg.image }
              }
            ]
          };
        }
        return { role: msg.role, content: msg.content };
      });

      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (response.status === 429) {
          toast({
            title: "⏳ Trop de requêtes",
            description: "L'API Gemini gratuite est limitée à 15 requêtes/minute. Attends 30 secondes puis réessaie.",
            variant: "destructive",
          });
        } else if (response.status === 402) {
          toast({
            title: "Crédits épuisés",
            description: "Les crédits IA sont épuisés.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Erreur",
            description: errorData.error || "Une erreur est survenue",
            variant: "destructive",
          });
        }
        setIsLoading(false);
        return;
      }

      // Check if it's a non-streaming response (locked content)
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        updateAssistant(content);
        setIsLoading(false);
        return;
      }

      // Streaming response
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) updateAssistant(content);
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      toast({
        title: "Erreur de connexion",
        description: "Impossible de contacter SIGMA.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      if (assistantContent) {
        persistMessage({ role: "assistant", content: assistantContent });
      }
    }
  }, [messages, toast, userId, persistMessage]);

  const clearMessages = useCallback(async () => {
    setMessages([]);
    if (userId) {
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("user_id", userId);
      if (error) console.error("Failed to clear history:", error);
    }
  }, [userId]);

  return { messages, isLoading, isHistoryLoading, sendMessage, clearMessages };
}
