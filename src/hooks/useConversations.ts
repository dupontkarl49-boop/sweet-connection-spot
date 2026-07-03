import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Conversation = {
  id: string;
  title: string;
  updated_at: string;
};

export function useConversations(userId: string | undefined) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setConversations([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) console.error("Failed to load conversations:", error);
    setConversations(data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const createConversation = useCallback(async (): Promise<string | null> => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: userId, title: "Nouvelle conversation" })
      .select("id, title, updated_at")
      .single();
    if (error || !data) {
      console.error("Failed to create conversation:", error);
      return null;
    }
    setConversations((prev) => [data, ...prev]);
    return data.id;
  }, [userId]);

  const deleteConversation = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) console.error("Failed to delete conversation:", error);
  }, []);

  const renameConversation = useCallback(async (id: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    const { error } = await supabase.from("conversations").update({ title }).eq("id", id);
    if (error) console.error("Failed to rename conversation:", error);
  }, []);

  return { conversations, loading, refresh, createConversation, deleteConversation, renameConversation };
}