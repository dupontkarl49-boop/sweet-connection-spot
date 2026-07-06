import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Sparkles } from "lucide-react";

const LEGACY_KEY = "sigma_chat_history";
const TARGET_CONVERSATION_ID = "67bf879d-f5d2-446c-acb6-e553a9530904";

type LegacyMessage = {
  role: "user" | "assistant";
  content: string;
  image?: string;
  images?: string[];
};

function readLegacy(): LegacyMessage[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v: unknown) => {
        if (!v || typeof v !== "object") return null;
        const m = v as Partial<LegacyMessage>;
        if (m.role !== "user" && m.role !== "assistant") return null;
        return {
          role: m.role,
          content: typeof m.content === "string" ? m.content : "",
          image: typeof m.image === "string" ? m.image : undefined,
          images: Array.isArray(m.images)
            ? m.images.filter((i): i is string => typeof i === "string")
            : undefined,
        } as LegacyMessage;
      })
      .filter((m): m is LegacyMessage => Boolean(m));
  } catch {
    return [];
  }
}

export function LegacyImportBanner({
  userId,
  dbMessageCount,
  historyLoading,
  onImported,
}: {
  userId: string;
  dbMessageCount: number;
  historyLoading: boolean;
  onImported: () => void;
}) {
  const [legacy, setLegacy] = useState<LegacyMessage[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [importing, setImporting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setLegacy(readLegacy());
  }, []);

  if (historyLoading) return null;
  if (dismissed) return null;
  if (legacy.length === 0) return null;
  if (dbMessageCount > 0) return null;

  const handleImport = async () => {
    setImporting(true);
    const rows = legacy.map((m) => ({
      user_id: userId,
      conversation_id: TARGET_CONVERSATION_ID,
      role: m.role,
      content: m.content,
      image: m.image ?? null,
      images: m.images ?? null,
    }));
    const { error } = await supabase.from("messages").insert(rows);
    if (error) {
      console.error("Import failed:", error);
      toast({
        title: "Échec de la restauration",
        description: error.message,
        variant: "destructive",
      });
      setImporting(false);
      return;
    }
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", TARGET_CONVERSATION_ID);
    toast({
      title: "Historique restauré",
      description: `${rows.length} message(s) réinjecté(s).`,
    });
    setImporting(false);
    onImported();
  };

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 mb-4">
      <div className="flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Historique local détecté
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>{legacy.length}</strong> message(s) trouvé(s) dans ce
            navigateur. Aucun message n'est actuellement stocké côté serveur.
            Veux-tu les restaurer dans « Historique restauré » ?
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? "Restauration..." : "Restaurer maintenant"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              disabled={importing}
            >
              Plus tard
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}