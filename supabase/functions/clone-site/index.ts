import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

const getGeminiKeys = () => [
  Deno.env.get("GEMINI_API_KEY"),
  Deno.env.get("GEMINI_API_KEY_2"),
  Deno.env.get("GEMINI_API_KEY_3"),
]
  .flatMap((v) => (v ?? "").split(","))
  .map((v) => v.trim())
  .filter((v) => v.startsWith("AIza"));

async function firecrawlScrape(url: string, formats: any[], extra: Record<string, unknown> = {}) {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("FIRECRAWL_API_KEY missing");
  const res = await fetch(`${FIRECRAWL_API}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats, onlyMainContent: false, waitFor: 2000, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Firecrawl ${res.status}`);
  return data;
}

async function callGemini(prompt: string): Promise<string> {
  for (const apiKey of getGeminiKeys()) {
    for (const model of GEMINI_MODELS) {
      try {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "Tu es SIGMA, expert en rétro-ingénierie web. Tu produis du code HTML/CSS/JS propre, fidèle au site analysé, en un seul fichier auto-suffisant." },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!res.ok) { await res.text().catch(() => ""); continue; }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim()) return content.trim();
      } catch (e) {
        console.error(`Gemini ${model} error:`, e);
      }
    }
  }
  throw new Error("Gemini indisponible");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: "URL invalide" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[clone-site] Cloning ${url}`);

    // 1. USSAE + DOM Reverse-Engineer + Behavior + Dynamic Script: une seule passe enrichie
    const main = await firecrawlScrape(url, ["html", "rawHtml", "links", "branding", "summary"]);

    // 2. Responsive Display Simulator: screenshots multi-viewport (en parallèle)
    const shots = await Promise.allSettled(
      VIEWPORTS.map((vp) =>
        firecrawlScrape(url, ["screenshot"], { viewport: { width: vp.width, height: vp.height } })
          .then((d) => ({ vp: vp.name, url: d?.data?.screenshot || d?.screenshot }))
      )
    );
    const screenshots = shots
      .filter((r): r is PromiseFulfilledResult<{ vp: string; url: string }> => r.status === "fulfilled" && !!r.value.url)
      .map((r) => r.value);

    const payload = main?.data ?? main;
    const html: string = payload?.html || payload?.rawHtml || "";
    const branding = payload?.branding || {};
    const links: string[] = payload?.links || [];
    const summary: string = payload?.summary || "";
    const meta = payload?.metadata || {};

    // 3. Holistic Synthesizer
    const truncatedHtml = html.slice(0, 60000);
    const prompt = `Analyse et reproduit fidèlement ce site web en un seul fichier HTML auto-suffisant (CSS inline dans <style>, JS inline dans <script>).

URL: ${url}
TITRE: ${meta?.title || ""}
RÉSUMÉ: ${summary}

IDENTITÉ VISUELLE (couleurs, fonts, logos):
${JSON.stringify(branding, null, 2)}

SCREENSHOTS DISPONIBLES (${screenshots.map((s) => s.vp).join(", ")}): utilise-les comme référence visuelle mentale.

LIENS DE NAVIGATION (top 20):
${links.slice(0, 20).join("\n")}

HTML SOURCE (tronqué):
\`\`\`html
${truncatedHtml}
\`\`\`

CONSIGNES:
- Reproduis la structure DOM, les styles, les couleurs, la typographie EXACTEMENT
- Rends-le responsive (mobile/tablet/desktop) avec media queries
- Inclus interactions/états (hover, focus, menus, modales) que tu détectes
- Tout en UN SEUL fichier HTML5 valide
- Réponds UNIQUEMENT avec le code dans un bloc \`\`\`html ... \`\`\``;

    const clonedCode = await callGemini(prompt);

    return new Response(JSON.stringify({
      success: true,
      url,
      title: meta?.title || url,
      branding,
      screenshots: screenshots.map((s) => ({ viewport: s.vp })),
      summary,
      code: clonedCode,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[clone-site] error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});