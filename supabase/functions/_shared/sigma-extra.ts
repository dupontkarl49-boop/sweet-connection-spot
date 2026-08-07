// SIGMA — Commandes additives (surveillance Gmail, notifications, confirmations).
// Module indépendant : ne modifie aucun comportement existant, retourne null si non concerné.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendMail } from "./gmail.ts";

export const adminClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

export type Owner = { userId?: string | null; chatId?: number | null };

function ownerFilter(q: any, owner: Owner) {
  return owner.userId ? q.eq("user_id", owner.userId) : q.eq("telegram_chat_id", owner.chatId ?? 0);
}

/** Enregistre une notification (et pousse sur Telegram si un chat est connu). */
export async function pushNotification(opts: {
  owner: Owner;
  kind?: string;
  title: string;
  body?: string;
  source?: string;
  refId?: string;
}) {
  const supabase = adminClient();
  await supabase.from("notifications").insert({
    user_id: opts.owner.userId ?? null,
    telegram_chat_id: opts.owner.chatId ?? null,
    kind: opts.kind ?? "info",
    title: opts.title,
    body: opts.body ?? "",
    source: opts.source ?? "sigma",
    ref_id: opts.refId ?? null,
  });

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (token && opts.owner.chatId) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: opts.owner.chatId,
        text: `🔔 *${opts.title}*\n\n${opts.body ?? ""}`.slice(0, 4000),
        parse_mode: "Markdown",
      }),
    }).catch(() => {});
  }
}

/** Crée une action sensible en attente de confirmation explicite. */
export async function queueSensitiveAction(owner: Owner, actionType: string, payload: Record<string, unknown>, summary: string) {
  const supabase = adminClient();
  const { data } = await supabase.from("pending_actions").insert({
    user_id: owner.userId ?? null,
    telegram_chat_id: owner.chatId ?? null,
    action_type: actionType,
    payload,
    summary,
  }).select("id").single();
  return data?.id as string | undefined;
}

async function listPending(owner: Owner) {
  const supabase = adminClient();
  const { data } = await ownerFilter(
    supabase.from("pending_actions").select("id, action_type, summary, created_at").eq("status", "pending"),
    owner,
  ).order("created_at", { ascending: true });
  return data ?? [];
}

async function executeAction(action: Record<string, any>): Promise<string> {
  if (action.action_type === "send_mail") {
    const p = action.payload ?? {};
    return await sendMail(String(p.to), String(p.subject ?? ""), String(p.body ?? ""));
  }
  return "⚠️ Type d'action inconnu.";
}

/**
 * Commandes additives :
 *   /watchmail on|off   — surveillance Gmail continue
 *   /notifs             — dernières notifications
 *   /pending            — actions sensibles en attente
 *   /confirm <n> | /cancel <n>
 * Retourne null si le texte n'est pas une de ces commandes.
 */
export async function handleExtraCommand(text: string, owner: Owner): Promise<string | null> {
  const t = (text ?? "").trim();
  const supabase = adminClient();

  const watch = t.match(/^\/watchmail(?:\s+(on|off))?\s*$/i);
  if (watch) {
    const enabled = (watch[1] ?? "on").toLowerCase() !== "off";
    const { data: existing } = await ownerFilter(supabase.from("gmail_watch_state").select("id"), owner).maybeSingle();
    if (existing?.id) {
      await supabase.from("gmail_watch_state").update({ enabled, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("gmail_watch_state").insert({
        user_id: owner.userId ?? null,
        telegram_chat_id: owner.chatId ?? null,
        enabled,
      });
    }
    return enabled
      ? "👁️ **Surveillance Gmail activée.** Je vérifie ta boîte en arrière-plan et je t'alerte dès qu'un email important arrive (avec un brouillon de réponse prêt)."
      : "💤 Surveillance Gmail désactivée.";
  }

  if (/^\/notifs?\b/i.test(t)) {
    const { data } = await ownerFilter(supabase.from("notifications").select("title, body, created_at, kind"), owner)
      .order("created_at", { ascending: false }).limit(8);
    if (!data || data.length === 0) return "🔕 Aucune notification pour le moment.";
    return `🔔 **Dernières notifications**\n\n${data.map((n: any, i: number) =>
      `${i + 1}. **${n.title}**\n   ${(n.body ?? "").slice(0, 200)}`).join("\n\n")}`;
  }

  if (/^\/pending\b/i.test(t)) {
    const list = await listPending(owner);
    if (list.length === 0) return "✅ Aucune action en attente de confirmation.";
    return `⏳ **Actions en attente**\n\n${list.map((a: any, i: number) =>
      `${i + 1}. ${a.summary}`).join("\n")}\n\nValide avec \`/confirm <n>\` ou annule avec \`/cancel <n>\`.`;
  }

  const confirm = t.match(/^\/(confirm|cancel)\s+(\d+)/i);
  if (confirm) {
    const list = await listPending(owner);
    const action = list[parseInt(confirm[2], 10) - 1];
    if (!action) return "❌ Numéro invalide. Fais `/pending`.";
    if (confirm[1].toLowerCase() === "cancel") {
      await supabase.from("pending_actions").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", action.id);
      return `🚫 Action annulée : ${action.summary}`;
    }
    const { data: full } = await supabase.from("pending_actions").select("*").eq("id", action.id).single();
    try {
      const result = await executeAction(full ?? {});
      await supabase.from("pending_actions").update({ status: "done", result, resolved_at: new Date().toISOString() }).eq("id", action.id);
      return result;
    } catch (e) {
      const msg = `❌ Échec : ${(e as Error).message}`;
      await supabase.from("pending_actions").update({ status: "failed", result: msg, resolved_at: new Date().toISOString() }).eq("id", action.id);
      return msg;
    }
  }

  return null;
}
