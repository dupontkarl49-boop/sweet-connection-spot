// SIGMA — Accès Gmail via le connecteur Lovable (gateway)

const GATEWAY = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

function authHeaders(): Record<string, string> | null {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const connKey = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!lovableKey || !connKey) return null;
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

export function gmailConfigured(): boolean {
  return authHeaders() !== null;
}

async function gmailFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = authHeaders();
  if (!headers) throw new Error("Gmail non connecté (connecteur manquant).");
  return await fetch(`${GATEWAY}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
}

function header(msg: Record<string, any>, name: string): string {
  const h = msg?.payload?.headers ?? [];
  return h.find((x: Record<string, string>) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Liste les derniers emails (résumé lisible). */
export async function listMail(query = "", max = 5): Promise<string> {
  const q = new URLSearchParams({ maxResults: String(max) });
  if (query) q.set("q", query);
  const res = await gmailFetch(`/users/me/messages?${q.toString()}`);
  const body = await res.text();
  if (!res.ok) throw new Error(`[${res.status}] ${body.slice(0, 400)}`);
  const data = JSON.parse(body);
  const ids: string[] = (data?.messages ?? []).map((m: Record<string, string>) => m.id);
  if (ids.length === 0) return "📭 Aucun email trouvé.";

  const details = await Promise.all(
    ids.map(async (id) => {
      const r = await gmailFetch(`/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      if (!r.ok) return null;
      return await r.json();
    }),
  );

  return details
    .filter(Boolean)
    .map((m: Record<string, any>, i: number) =>
      `${i + 1}. **${header(m, "Subject") || "(sans objet)"}**\n   De : ${header(m, "From")}\n   ${header(m, "Date")}\n   ${(m.snippet ?? "").slice(0, 180)}`)
    .join("\n\n");
}

function encodeRaw(to: string, subject: string, body: string): string {
  const mail = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'Content-Type: text/plain; charset="UTF-8"',
    "MIME-Version: 1.0",
    "",
    body,
  ].join("\r\n");
  const bytes = new TextEncoder().encode(mail);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Envoie un email depuis le compte Gmail connecté. */
export async function sendMail(to: string, subject: string, body: string): Promise<string> {
  const res = await gmailFetch("/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: encodeRaw(to, subject, body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[${res.status}] ${text.slice(0, 400)}`);
  return `✅ Email envoyé à ${to}.`;
}

/**
 * Traite les commandes Gmail :
 *   /mail            → 5 derniers emails
 *   /mail <requête>  → recherche Gmail (ex: /mail is:unread)
 *   /sendmail destinataire | objet | message
 * Retourne null si le texte n'est pas une commande Gmail.
 */
export async function handleMailCommand(text: string): Promise<string | null> {
  const t = (text ?? "").trim();
  const send = t.match(/^\/sendmail\s+([\s\S]+)/i);
  if (send) {
    if (!gmailConfigured()) return "⚠️ Gmail n'est pas connecté au projet.";
    const parts = send[1].split("|").map((p) => p.trim());
    if (parts.length < 3 || !parts[0].includes("@")) {
      return "Format : `/sendmail destinataire@mail.com | Objet | Message`";
    }
    try {
      return await sendMail(parts[0], parts[1], parts.slice(2).join(" | "));
    } catch (e) {
      return `❌ Envoi impossible : ${(e as Error).message}`;
    }
  }

  const list = t.match(/^\/mail(?:\s+([\s\S]+))?$/i);
  if (list) {
    if (!gmailConfigured()) return "⚠️ Gmail n'est pas connecté au projet.";
    try {
      const out = await listMail((list[1] ?? "").trim(), 5);
      return `📬 **Boîte Gmail**\n\n${out}`;
    } catch (e) {
      return `❌ Lecture impossible : ${(e as Error).message}`;
    }
  }

  return null;
}