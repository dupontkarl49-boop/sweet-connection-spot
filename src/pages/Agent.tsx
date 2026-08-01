import { useEffect, useState, useCallback } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Bot, Globe, Brain, Play, Trash2, Sparkles } from "lucide-react";

type Task = {
  id: string;
  title: string;
  prompt: string;
  mode: string;
  interval_minutes: number;
  active: boolean;
  next_run_at: string;
  last_run_at: string | null;
};

type Run = {
  id: string;
  task_id: string;
  status: string;
  output: string;
  created_at: string;
};

const INTERVALS = [
  { value: "60", label: "Toutes les heures" },
  { value: "360", label: "Toutes les 6 heures" },
  { value: "720", label: "Toutes les 12 heures" },
  { value: "1440", label: "Une fois par jour" },
  { value: "10080", label: "Une fois par semaine" },
];

const Agent = () => {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("research");
  const [interval, setIntervalValue] = useState("1440");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    const [{ data: t }, { data: r }] = await Promise.all([
      supabase.from("agent_tasks").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("agent_runs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(15),
    ]);
    setTasks((t as Task[]) ?? []);
    setRuns((r as Run[]) ?? []);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTask = async () => {
    if (!user || !prompt.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("agent_tasks").insert({
      user_id: user.id,
      title: title.trim() || prompt.trim().slice(0, 50),
      prompt: prompt.trim(),
      mode,
      interval_minutes: Number(interval),
      next_run_at: new Date(Date.now() + 60_000).toISOString(),
    });
    setBusy(false);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
      return;
    }
    setPrompt("");
    setTitle("");
    toast({ title: "Tâche créée", description: "SIGMA l'exécutera automatiquement." });
    refresh();
  };

  const runNow = async (taskId: string) => {
    setBusy(true);
    const { error } = await supabase.functions.invoke("agent-runner", { body: { task_id: taskId } });
    setBusy(false);
    if (error) {
      toast({ title: "Erreur", description: "Exécution impossible.", variant: "destructive" });
      return;
    }
    toast({ title: "Exécutée ⚡", description: "Le résultat arrive dans l'historique." });
    refresh();
  };

  const toggleTask = async (task: Task) => {
    await supabase.from("agent_tasks").update({ active: !task.active }).eq("id", task.id);
    refresh();
  };

  const removeTask = async (taskId: string) => {
    await supabase.from("agent_tasks").delete().eq("id", taskId);
    refresh();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/25">
            <Bot className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">Agent autonome</h1>
            <p className="text-xs text-muted-foreground">SIGMA travaille même quand tu dors</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h2 className="font-semibold text-foreground">Nouvelle mission</h2>

          <div className="space-y-2">
            <Label htmlFor="title">Nom (optionnel)</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Veille IA quotidienne" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="prompt">Instruction</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Résume-moi les actualités IA les plus importantes des dernières 24h"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="research">🌐 Recherche web autonome</SelectItem>
                  <SelectItem value="chat">🧠 Réflexion IA seule</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fréquence</Label>
              <Select value={interval} onValueChange={setIntervalValue}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={createTask} disabled={busy || !prompt.trim()} className="w-full">
            Lancer l'agent
          </Button>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-foreground">Tâches actives</h2>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune tâche pour l'instant.</p>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {task.mode === "research" ? <Globe className="w-4 h-4 text-accent" /> : <Brain className="w-4 h-4 text-primary" />}
                    <span className="font-medium text-foreground truncate">{task.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.prompt}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Toutes les {task.interval_minutes} min • {task.active ? "actif" : "en pause"}
                    {task.last_run_at ? ` • dernière: ${new Date(task.last_run_at).toLocaleString("fr-FR")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => runNow(task.id)} disabled={busy} title="Exécuter maintenant">
                    <Play className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleTask(task)}>
                    {task.active ? "Pause" : "Reprendre"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => removeTask(task.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold text-foreground">Derniers rapports</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Les rapports apparaîtront ici (et dans ton chat).</p>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="bg-card border border-border rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-2">
                  {new Date(run.created_at).toLocaleString("fr-FR")} • {run.status === "ok" ? "✅" : "⚠️"}
                </p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{run.output}</p>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
};

export default Agent;
