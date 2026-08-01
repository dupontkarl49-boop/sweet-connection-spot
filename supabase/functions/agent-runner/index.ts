import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TELEGRAM_API = "https://api.telegram.org/bot";
const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const LOVABLE_MODELS = ["google/gemini-2.5-flash", "openai/gpt-5-mini"];

const AGENT_SYSTEM = `Tu es SIGMA, une IA autonome avancée qui exécute des tâches planifiées pour son utilisateur.
Tu produis un rapport clair, structuré, dense en information utile et sans blabla inutile.
Format: un titre court, puis des points clés, puis (si pertinent) une conclusion/action recommandée.
Utilise des emojis pertinents avec parcimonie. Réponds dans la langue de l'instruction. Max ~3500 caractères.`;

const keys = (...names: string[]) =>
  names
    .flatMap((n) => (Deno.env.get(n) ?? "").split(","))
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

const geminiKeys = () => keys("GEMINI_API_KEY", "GEMINI_API_KEYS", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3").filter((k) => k.startsWith("AIza"));
const groqKeys = () => keys("GROQ_API_KEY", "GROQ_API_KEYS").filter((k) => k.startsWith("gsk_"));

async function fetchWithTimeout(url: string, init: RequestInit, ms = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callOpenAICompatible(url: string, apiKey: string, model: string, messages: unknown[]): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages }),
    });
    if (!res.ok) { await res.text().catch(() => ""); return null; }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim() ? content.trim() : null;
  } catch (e) {
    console.error(`${model} error:`, (e as Error).message);
    return null;
  }
}

async function runAI(userPrompt: string): Promise<string | null> {
  const messages = [
    { role: "system", content: AGENT_SYSTEM },
    { role: "user", content: userPrompt },
  ];

  for (const key of geminiKeys()) {
    for (const model of GEMINI_MODELS) {
      const out = await callOpenAICompatible("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key, model, messages);
      if (out) return out;
    }
  }
  for (const key of groqKeys()) {
    for (const model of GROQ_MODELS) {
      const out = await callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", key, model, messages);
      if (out) return out;
    }
  }
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (lovableKey) {
    for (const model of LOVABLE_MODELS) {
      try {
        const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Lovable-API-Key": lovableKey, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages }),
        });
        if (!res.ok) { await res.text().catch(() => ""); continue; }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim()) return content.trim();
      } catch (e) {
        console.error("Lovable gateway error:", (e as Error).message);
      }
    }
  }
  return null;
}

async function webResearch(query: string): Promise<string> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return "";
  try {
    const res = await fetchWithTimeout(`${FIRECRAWL_API}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 5, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }),
    }, 45000);
    const data = await res.json();
    if (!res.ok) { console.error("Firecrawl search failed:", JSON.stringify(data).slice(0, 400)); return ""; }
    const results = data?.data?.web ?? data?.data ?? [];
    if (!Array.isArray(results) || results.length === 0) return "";
    return results
      .slice(0, 5)
      .map((r: Record<string, string>, i: number) =>
        `### Source ${i + 1}: ${r.title ?? ""}\nURL: ${r.url ?? ""}\n${(r.markdown ?? r.description ?? "").slice(0, 2500)}`)
      .join("\n\n");
  } catch (e) {
    console.error("Firecrawl error:", (e as Error).message);
    return "";
  }
}

async function sendTelegram(chatId: number, text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  const chunks = text.match(/[\s\S]{1,3800}/g) ?? [text];
  for (const chunk of chunks) {
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: "Markdown" }),
    });
    if (!res.ok) {
      await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron sends minimal payload */ }

  const singleTaskId = typeof body.task_id === "string" ? body.task_id : null;

  const query = supabase
    .from("agent_tasks")
    .select("*")
    .eq("active", true)
    .order("next_run_at", { ascending: true })
    .limit(5);

  const { data: tasks, error } = singleTaskId
    ? await supabase.from("agent_tasks").select("*").eq("id", singleTaskId).limit(1)
    : await query.lte("next_run_at", new Date().toISOString());

  if (error) {
    console.error("Task fetch error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const executed: string[] = [];

  for (const task of tasks ?? []) {
    try {
      let context = "";
      if (task.mode === "research") {
        context = await webResearch(task.prompt);
      }

      const now = new Date().toLocaleString("fr-FR", { timeZone: "UTC" });
      const prompt = context
        ? `Date/heure actuelle (UTC): ${now}\n\nTÂCHE: ${task.prompt}\n\nSOURCES WEB RÉCENTES:\n${context}\n\nProduis une synthèse structurée, factuelle, en citant les sources utiles (URL).`
        : `Date/heure actuelle (UTC): ${now}\n\nTÂCHE: ${task.prompt}`;

      const output = await runAI(prompt);
      const status = output ? "ok" : "error";
      const finalText = output ?? "⚠️ SIGMA n'a pas pu exécuter cette tâche (tous les moteurs IA sont indisponibles). Nouvelle tentative au prochain cycle.";

      await supabase.from("agent_runs").insert({
        task_id: task.id,
        user_id: task.user_id,
        status,
        output: finalText,
      });

      if (task.user_id) {
        await supabase.from("messages").insert({
          user_id: task.user_id,
          role: "assistant",
          content: `🤖 **Agent SIGMA — ${task.title}**\n\n${finalText}`,
        });
      }

      if (task.telegram_chat_id) {
        await sendTelegram(Number(task.telegram_chat_id), `🤖 *Agent SIGMA — ${task.title}*\n\n${finalText}`);
      }

      const next = new Date(Date.now() + Math.max(5, task.interval_minutes) * 60_000).toISOString();
      await supabase
        .from("agent_tasks")
        .update({ last_run_at: new Date().toISOString(), next_run_at: next })
        .eq("id", task.id);

      executed.push(task.id);
    } catch (e) {
      console.error(`Task ${task.id} failed:`, (e as Error).message);
    }
  }

  return new Response(JSON.stringify({ executed: executed.length, task_ids: executed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
