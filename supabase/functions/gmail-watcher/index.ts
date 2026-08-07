// SIGMA — Surveillance Gmail autonome (exécutée par cron, indépendante du web/Telegram).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchMessages, createDraft, gmailConfigured, type MailSummary } from "../_shared/gmail.ts";
import { adminClient, pushNotification } from "../_shared/sigma-extra.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

const keys = (...names: string[]) =>
  names.flatMap((n) => (Deno.env.get(n) ?? "").split(",")).map((v) => v.trim()).filter(Boolean);

async function askAI(prompt: string): Promise<string | null> {
  const messages = [
    { role: "system", content: "Tu es SIGMA, assistant email. Tu réponds UNIQUEMENT en JSON valide, sans texte autour." },
    { role: "user", content: prompt },
  ];

  for (const key of keys("GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3", "GEMINI_API_KEYS").filter((k) => k.startsWith("AIza"))) {
    for (const model of GEMINI_MODELS) {
      try {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages }),
        });
        if (!r.ok) { await r.text().catch(() => ""); continue; }
        const c = (await r.json())?.choices?.[0]?.message?.content;
        if (typeof c === "string" && c.trim()) return c;
      } catch (_) { /* provider suivant */ }
    }
  }

  for (const key of keys("GROQ_API_KEY", "GROQ_API_KEYS").filter((k) => k.startsWith("gsk_"))) {
    for (const model of GROQ_MODELS) {
      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages }),
        });
        if (!r.ok) { await r.text().catch(() => ""); continue; }
        const c = (await r.json())?.choices?.[0]?.message?.content;
        if (typeof c === "string" && c.trim()) return c;
      } catch (_) { /* provider suivant */ }
    }
  }

  return null;
}

function parseJson(raw: string | null): Record<string, any> | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function senderEmail(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from.trim();
}

async function analyse(mail: MailSummary) {
  const raw = await askAI(
    `Analyse cet email reçu et réponds en JSON strict: {"important": true|false, "raison": "…", "reponse_suggeree": "…"}.\n` +
    `"important" = true seulement si l'email demande une action, une réponse, concerne un rendez-vous, un paiement, une opportunité ou une urgence. ` +
    `Les newsletters, promos et notifications automatiques sont false.\n` +
    `"reponse_suggeree" = brouillon de réponse court, poli, en français (vide si non pertinent).\n\n` +
    `De: ${mail.from}\nObjet: ${mail.subject}\nExtrait: ${mail.snippet}`,
  );
  return parseJson(raw) ?? { important: false, raison: "", reponse_suggeree: "" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = adminClient();
  const report: string[] = [];

  try {
    if (!gmailConfigured()) {
      return new Response(JSON.stringify({ ok: false, error: "Gmail non connecté" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: watchers } = await supabase
      .from("gmail_watch_state")
      .select("*")
      .eq("enabled", true);

    for (const w of watchers ?? []) {
      const owner = { userId: w.user_id, chatId: w.telegram_chat_id };
      let newest = Number(w.last_seen_internal_ms ?? 0);

      let mails: MailSummary[] = [];
      try {
        mails = await fetchMessages("in:inbox is:unread newer_than:2d", 10);
      } catch (e) {
        report.push(`fetch error: ${(e as Error).message}`);
        continue;
      }

      const fresh = mails.filter((m) => m.internalMs > Number(w.last_seen_internal_ms ?? 0));
      for (const mail of fresh) {
        newest = Math.max(newest, mail.internalMs);

        const { data: seen } = await supabase
          .from("notifications").select("id").eq("ref_id", mail.id).limit(1);
        if (seen && seen.length > 0) continue;

        const verdict = await analyse(mail);
        if (!verdict.important) continue;

        let draftNote = "";
        if (w.auto_draft && verdict.reponse_suggeree) {
          try {
            await createDraft(
              senderEmail(mail.from),
              mail.subject.startsWith("Re:") ? mail.subject : `Re: ${mail.subject}`,
              String(verdict.reponse_suggeree),
              mail.threadId,
            );
            draftNote = "\n\n📝 Un brouillon de réponse est prêt dans Gmail.";
          } catch (e) {
            draftNote = `\n\n⚠️ Brouillon impossible : ${(e as Error).message}`;
          }
        }

        await pushNotification({
          owner,
          kind: "email_important",
          source: "gmail",
          refId: mail.id,
          title: `📧 Email important — ${mail.subject}`,
          body: `De : ${mail.from}\n${verdict.raison ? `Pourquoi : ${verdict.raison}\n` : ""}\n${mail.snippet.slice(0, 300)}` +
            (verdict.reponse_suggeree ? `\n\n💬 Réponse suggérée :\n${verdict.reponse_suggeree}` : "") + draftNote,
        });
        report.push(`notified ${mail.id}`);
      }

      // Rappels : emails importants toujours sans réponse après 24h
      try {
        const old = await fetchMessages("in:inbox is:unread older_than:1d newer_than:7d", 5);
        for (const mail of old) {
          const refId = `reminder:${mail.id}`;
          const { data: already } = await supabase
            .from("notifications").select("id").eq("ref_id", refId).limit(1);
          if (already && already.length > 0) continue;
          const { data: wasImportant } = await supabase
            .from("notifications").select("id").eq("ref_id", mail.id).limit(1);
          if (!wasImportant || wasImportant.length === 0) continue;

          await pushNotification({
            owner,
            kind: "email_reminder",
            source: "gmail",
            refId,
            title: `⏰ Rappel — email en attente de réponse`,
            body: `« ${mail.subject} » de ${mail.from} attend toujours une réponse.`,
          });
        }
      } catch (_) { /* rappels non bloquants */ }

      await supabase.from("gmail_watch_state").update({
        last_checked_at: new Date().toISOString(),
        last_seen_internal_ms: newest,
        updated_at: new Date().toISOString(),
      }).eq("id", w.id);
    }

    return new Response(JSON.stringify({ ok: true, report }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gmail-watcher error:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
