import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import JSZip from "npm:jszip@3.10.1";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

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

const MAX_ASSETS = 60;
const MAX_ASSET_BYTES = 5 * 1024 * 1024; // 5MB par asset
const ASSET_TIMEOUT_MS = 15000;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

function extFromContentType(ct: string): string {
  const m: Record<string, string> = {
    "text/css": "css", "application/javascript": "js", "text/javascript": "js",
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
    "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
    "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf",
    "application/font-woff": "woff", "application/font-woff2": "woff2",
    "video/mp4": "mp4",
  };
  return m[ct.split(";")[0].trim().toLowerCase()] || "bin";
}

function folderFor(ct: string): string {
  const c = ct.toLowerCase();
  if (c.startsWith("image/")) return "images";
  if (c.startsWith("font/") || c.includes("font")) return "fonts";
  if (c.includes("css")) return "css";
  if (c.includes("javascript")) return "js";
  if (c.startsWith("video/")) return "media";
  if (c.startsWith("audio/")) return "media";
  return "assets";
}

function extractAssetUrls(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  const base = new URL(baseUrl);
  const patterns = [
    /<link[^>]+href=["']([^"']+)["']/gi,
    /<script[^>]+src=["']([^"']+)["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi,
    /<source[^>]+src=["']([^"']+)["']/gi,
    /<video[^>]+poster=["']([^"']+)["']/gi,
    /url\(["']?([^"')]+)["']?\)/gi,
    /srcset=["']([^"']+)["']/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const raw = m[1];
      if (!raw || raw.startsWith("data:") || raw.startsWith("#")) continue;
      // srcset can contain multiple urls
      const candidates = raw.includes(",") && re.source.includes("srcset")
        ? raw.split(",").map((s) => s.trim().split(/\s+/)[0])
        : [raw];
      for (const c of candidates) {
        try {
          const abs = new URL(c, base).toString();
          if (abs.startsWith("http")) found.add(abs);
        } catch { /* ignore */ }
      }
    }
  }
  return [...found].slice(0, MAX_ASSETS);
}

async function fetchAsset(url: string): Promise<{ url: string; bytes: Uint8Array; contentType: string } | null> {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), ASSET_TIMEOUT_MS);
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 SIGMA-Clone/1.0" } });
    clearTimeout(to);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "application/octet-stream";
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength > MAX_ASSET_BYTES) return null;
    return { url, bytes: buf, contentType: ct };
  } catch {
    return null;
  }
}

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

    // 4. ZIP des assets réels du site + page clonée par IA
    const zip = new JSZip();
    const root = zip.folder("clone")!;

    // Page reconstituée par SIGMA
    const aiCodeMatch = clonedCode.match(/```html\s*([\s\S]*?)```/i);
    const aiHtml = (aiCodeMatch ? aiCodeMatch[1] : clonedCode).trim();
    root.file("sigma-clone.html", aiHtml);

    // HTML original
    if (html) root.file("original.html", html);

    // README
    root.file("README.txt",
      `Clone SIGMA\n===========\nSource: ${url}\nTitre: ${meta?.title || ""}\nGénéré: ${new Date().toISOString()}\n\nContenu:\n- sigma-clone.html : page reconstituée par SIGMA (auto-suffisante)\n- original.html    : HTML brut récupéré du site source\n- assets/          : ressources (images, css, js, fonts) téléchargées du site\n- screenshots/     : captures multi-viewports (si disponibles)\n- branding.json    : couleurs, fontes, logos détectés\n`
    );

    // Branding
    if (branding && Object.keys(branding).length) {
      root.file("branding.json", JSON.stringify(branding, null, 2));
    }

    // Screenshots base64 -> images
    const shotsFolder = root.folder("screenshots")!;
    for (const s of screenshots) {
      try {
        let dataUrl = (s as any).url || "";
        // peut être une URL http ou un data:url
        if (dataUrl.startsWith("http")) {
          const r = await fetchAsset(dataUrl);
          if (r) shotsFolder.file(`${s.vp}.${extFromContentType(r.contentType)}`, r.bytes);
        } else if (dataUrl.startsWith("data:")) {
          const [, b64] = dataUrl.split(",");
          if (b64) {
            const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            shotsFolder.file(`${s.vp}.png`, bin);
          }
        }
      } catch { /* ignore */ }
    }

    // Assets réels du site (parallèle, limités)
    const assetUrls = extractAssetUrls(html, url);
    const fetched = await Promise.all(assetUrls.map(fetchAsset));
    const manifest: { source: string; path: string; size: number; type: string }[] = [];
    for (const a of fetched) {
      if (!a) continue;
      const u = new URL(a.url);
      const sub = folderFor(a.contentType);
      let name = sanitizeFilename(u.pathname.split("/").pop() || "");
      if (!name.includes(".")) name = `${name || "file"}.${extFromContentType(a.contentType)}`;
      const path = `${sub}/${name}`;
      root.folder(sub)!.file(name, a.bytes);
      manifest.push({ source: a.url, path, size: a.bytes.byteLength, type: a.contentType });
    }
    root.file("assets-manifest.json", JSON.stringify(manifest, null, 2));

    const zipBytes: Uint8Array = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    // 5. Upload + signed URL
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const slug = (meta?.title || new URL(url).hostname).toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "clone";
    const fileName = `${slug}-${Date.now()}.zip`;
    const objectPath = `clones/${fileName}`;

    const up = await supa.storage.from("clones").upload(objectPath, zipBytes, {
      contentType: "application/zip", upsert: true,
    });
    if (up.error) throw new Error(`Upload zip: ${up.error.message}`);

    const signed = await supa.storage.from("clones").createSignedUrl(objectPath, 60 * 60 * 24 * 7); // 7 jours
    if (signed.error || !signed.data?.signedUrl) throw new Error(`Signed URL: ${signed.error?.message || "no url"}`);

    return new Response(JSON.stringify({
      success: true,
      url,
      title: meta?.title || url,
      branding,
      screenshots: screenshots.map((s) => ({ viewport: s.vp })),
      summary,
      code: aiHtml,
      assetsCount: manifest.length,
      zipSize: zipBytes.byteLength,
      zipName: fileName,
      downloadUrl: signed.data.signedUrl,
      expiresInDays: 7,
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