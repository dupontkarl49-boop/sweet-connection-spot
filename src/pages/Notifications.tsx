import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Bell, Check, Mail, RefreshCw, ShieldCheck, X } from "lucide-react";

type Notif = {
  id: string;
  kind: string;
  title: string;
  body: string;
  source: string;
  read: boolean;
  created_at: string;
};

type PendingAction = {
  id: string;
  action_type: string;
  summary: string;
  status: string;
  created_at: string;
};

const Notifications = () => {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: n }, { data: p }, { data: w }] = await Promise.all([
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("pending_actions").select("*").eq("status", "pending").order("created_at", { ascending: true }),
      supabase.from("gmail_watch_state").select("enabled").maybeSingle(),
    ]);
    setNotifs((n ?? []) as Notif[]);
    setPending((p ?? []) as PendingAction[]);
    setWatching(Boolean(w?.enabled));
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const toggleWatch = async (enabled: boolean) => {
    if (!user) return;
    setWatching(enabled);
    const { data: existing } = await supabase.from("gmail_watch_state").select("id").maybeSingle();
    if (existing?.id) {
      await supabase.from("gmail_watch_state").update({ enabled }).eq("id", existing.id);
    } else {
      await supabase.from("gmail_watch_state").insert({ user_id: user.id, enabled });
    }
    toast({
      title: enabled ? "Surveillance Gmail activée" : "Surveillance Gmail désactivée",
      description: enabled
        ? "SIGMA analyse ta boîte en arrière-plan et prépare des brouillons de réponse."
        : "SIGMA ne surveillera plus ta boîte Gmail.",
    });
  };

  const runNow = async () => {
    setBusy(true);
    await supabase.functions.invoke("gmail-watcher", { body: {} }).catch(() => {});
    await load();
    setBusy(false);
  };

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const resolve = async (id: string, status: "done" | "cancelled") => {
    await supabase.from("pending_actions").update({ status, resolved_at: new Date().toISOString() }).eq("id", id);
    setPending((prev) => prev.filter((a) => a.id !== id));
    toast({
      title: status === "done" ? "Action confirmée" : "Action annulée",
      description: status === "done"
        ? "SIGMA exécutera l'action confirmée."
        : "L'action sensible a été annulée.",
    });
  };

  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/"><ArrowLeft className="w-4 h-4" /></Link>
            </Button>
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-bold tracking-tight">Notifications</h1>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={runNow} disabled={busy} title="Vérifier maintenant">
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        <section className="rounded-xl border border-border bg-card/40 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <Label className="text-sm font-semibold">Surveillance Gmail continue</Label>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  SIGMA vérifie ta boîte en arrière-plan (même site fermé), détecte les emails importants,
                  prépare un brouillon de réponse et t'alerte ici et sur Telegram.
                </p>
              </div>
            </div>
            <Switch checked={watching} onCheckedChange={toggleWatch} />
          </div>
        </section>

        {pending.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" /> Actions sensibles en attente
            </h2>
            {pending.map((a) => (
              <div key={a.id} className="rounded-xl border border-border bg-card/40 p-4 flex items-center justify-between gap-4">
                <p className="text-sm">{a.summary}</p>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={() => resolve(a.id, "done")}><Check className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => resolve(a.id, "cancelled")}><X className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Alertes récentes</h2>
          {notifs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucune notification pour l'instant. Active la surveillance Gmail pour recevoir des alertes.
            </p>
          )}
          {notifs.map((n) => (
            <article
              key={n.id}
              className={`rounded-xl border p-4 transition-colors ${n.read ? "border-border bg-card/20 opacity-70" : "border-primary/40 bg-card/50"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{n.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {new Date(n.created_at).toLocaleString("fr-FR")} • {n.source}
                  </p>
                </div>
                {!n.read && (
                  <Button size="sm" variant="ghost" onClick={() => markRead(n.id)} title="Marquer comme lu">
                    <Check className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
};

export default Notifications;
