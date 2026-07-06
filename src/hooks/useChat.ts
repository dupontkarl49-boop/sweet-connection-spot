import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Message = {
  role: "user" | "assistant";
  content: string;
  image?: string;
  images?: string[];
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
    images: Array.isArray(message.images) ? message.images.filter((i): i is string => typeof i === "string") : undefined,
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

export function useChat(userId: string | undefined, conversationId: string | undefined) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const { toast } = useToast();

  // Load messages from database when user changes
  useEffect(() => {
    if (!userId || !conversationId) {
      setMessages([]);
      setIsHistoryLoading(!!userId && !conversationId);
      return;
    }

    let cancelled = false;
    setIsHistoryLoading(true);
    supabase
      .from("messages")
      .select("role, content, image, images")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
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
            images: m.images ?? undefined,
          }));
          setMessages(cloudMessages);
        }
        setIsHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, conversationId]);

  const persistMessage = useCallback(
    async (msg: Message) => {
      if (!userId || !conversationId) return;
      const { error } = await supabase.from("messages").insert({
        user_id: userId,
        conversation_id: conversationId,
        role: msg.role,
        content: msg.content,
        image: msg.image ?? null,
        images: msg.images ?? null,
      });
      if (error) console.error("Failed to save message:", error);
    },
    [userId, conversationId]
  );

  const sendMessage = useCallback(async (input: string, imagesBase64?: string[]) => {
    if (!userId || !conversationId) return;
    const userMessage: Message = {
      role: "user",
      content: input,
      image: imagesBase64?.[0],
      images: imagesBase64,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    persistMessage(userMessage);

    // Auto-title new conversations from first user message
    void supabase
      .from("conversations")
      .update({
        title: input.slice(0, 60) || "Nouvelle conversation",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("title", "Nouvelle conversation");

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
        const imgs = msg.images && msg.images.length > 0 ? msg.images : msg.image ? [msg.image] : [];
        if (imgs.length > 0) {
          return {
            role: msg.role,
            content: [
              ...(msg.content ? [{ type: "text", text: msg.content }] : []),
              ...imgs.map((url) => ({ type: "image_url", image_url: { url } })),
            ]
          };
        }
        return { role: msg.role, content: msg.content };
      });

      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${
            (await supabase.auth.getSession()).data.session?.access_token ?? ""
          }`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          toast({
            title: "🔒 Session expirée",
            description: "Reconnecte-toi pour continuer.",
            variant: "destructive",
          });
        } else if (response.status === 429) {
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
        void supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);
      }
    }
  }, [messages, toast, userId, conversationId, persistMessage]);

  const clearMessages = useCallback(async () => {
    setMessages([]);
    if (userId && conversationId) {
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("user_id", userId)
        .eq("conversation_id", conversationId);
      if (error) console.error("Failed to clear history:", error);
    }
  }, [userId]);

  return { messages, isLoading, isHistoryLoading, sendMessage, clearMessages };
}
