import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

type Message = {
  role: "user" | "assistant";
  content: string;
  image?: string;
};

const CHAT_URL = "https://sigma-backend.onrender.com/chat";
const STORAGE_KEY = "sigma_chat_history";

// Load messages from localStorage
const loadMessages = (): Message[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error("Failed to load chat history:", error);
  }
  return [];
};

// Save messages to localStorage
const saveMessages = (messages: Message[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch (error) {
    console.error("Failed to save chat history:", error);
  }
};

export function useChat() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Save to localStorage whenever messages change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const sendMessage = useCallback(async (input: string, imageBase64?: string) => {
    const userMessage: Message = { role: "user", content: input, image: imageBase64 };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

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
            title: "Trop de requêtes",
            description: "Attends un peu avant de réessayer.",
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
    }
  }, [messages, toast]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, isLoading, sendMessage, clearMessages };
}
