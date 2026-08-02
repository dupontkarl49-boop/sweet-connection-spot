// SIGMA — Moteur de recherche autonome multi-moteurs (sans clé requise + Firecrawl en bonus)

export type SearchHit = { title: string; url: string; snippet: string; engine: string };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const strip = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function decodeDuck(href: string): string {
  try {
    const m = href.match(/uddg=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : href;
  } catch {
    return href;
  }
}

async function duckduckgo(q: string): Promise<SearchHit[]> {
  try {
    const res = await withTimeout(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": UA, Accept: "text/html" } },
      12000,
    );
    if (!res.ok) return [];
    const html = await res.text();
    const hits: SearchHit[] = [];
    const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < 8) {
      const url = decodeDuck(m[1]);
      if (!/^https?:\/\//.test(url)) continue;
      hits.push({ title: strip(m[2]), url, snippet: "", engine: "DuckDuckGo" });
    }
    return hits;
  } catch {
    return [];
  }
}

async function bing(q: string): Promise<SearchHit[]> {
  try {
    const res = await withTimeout(
      `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=fr`,
      { headers: { "User-Agent": UA, Accept: "text/html" } },
      12000,
    );
    if (!res.ok) return [];
    const html = await res.text();
    const hits: SearchHit[] = [];
    const re = /<li class="b_algo"[\s\S]*?<h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)<\/li>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && hits.length < 8) {
      if (!/^https?:\/\//.test(m[1])) continue;
      hits.push({ title: strip(m[2]), url: m[1], snippet: strip(m[3]).slice(0, 300), engine: "Bing" });
    }
    return hits;
  } catch {
    return [];
  }
}

async function googleNews(q: string): Promise<SearchHit[]> {
  try {
    const res = await withTimeout(
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`,
      { headers: { "User-Agent": UA } },
      12000,
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const hits: SearchHit[] = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) && hits.length < 8) {
      const block = m[1];
      const title = strip(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const url = strip(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
      const date = strip(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "");
      if (title && url) hits.push({ title, url, snippet: date, engine: "Google News" });
    }
    return hits;
  } catch {
    return [];
  }
}

async function firecrawlSearch(q: string): Promise<SearchHit[]> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return [];
  try {
    const res = await withTimeout(
      "https://api.firecrawl.dev/v2/search",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit: 6 }),
      },
      20000,
    );
    if (!res.ok) return [];
    const data = await res.json();
    const results = data?.data?.web ?? data?.data ?? [];
    if (!Array.isArray(results)) return [];
    return results
      .filter((r: Record<string, string>) => r?.url)
      .map((r: Record<string, string>) => ({
        title: r.title ?? "",
        url: r.url,
        snippet: (r.description ?? "").slice(0, 300),
        engine: "Firecrawl",
      }));
  } catch {
    return [];
  }
}

async function scrapePage(url: string): Promise<string> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (key) {
    try {
      const res = await withTimeout(
        "https://api.firecrawl.dev/v2/scrape",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        },
        20000,
      );
      if (res.ok) {
        const d = await res.json();
        const md = d?.markdown ?? d?.data?.markdown;
        if (typeof md === "string" && md.trim()) return md.slice(0, 3000);
      }
    } catch { /* fallback below */ }
  }
  try {
    const res = await withTimeout(url, { headers: { "User-Agent": UA } }, 10000);
    if (!res.ok) return "";
    const html = await res.text();
    return strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")).slice(0, 2500);
  } catch {
    return "";
  }
}

/**
 * Recherche autonome : interroge plusieurs moteurs en parallèle, déduplique,
 * puis lit le contenu des meilleures sources. Ne dépend d'aucune clé obligatoire.
 */
export async function autonomousSearch(query: string, opts?: { deep?: boolean }): Promise<string> {
  const engines = await Promise.all([duckduckgo(query), bing(query), googleNews(query), firecrawlSearch(query)]);
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  // entrelacement des moteurs pour la diversité des sources
  for (let i = 0; i < 8; i++) {
    for (const list of engines) {
      const h = list[i];
      if (!h) continue;
      const k = h.url.replace(/[#?].*$/, "");
      if (seen.has(k)) continue;
      seen.add(k);
      hits.push(h);
    }
  }
  if (hits.length === 0) return "";

  const top = hits.slice(0, opts?.deep ? 5 : 3);
  const pages = await Promise.all(top.map((h) => scrapePage(h.url)));

  const detailed = top
    .map((h, i) => `### Source ${i + 1} — ${h.title} (${h.engine})\nURL: ${h.url}\n${pages[i] || h.snippet}`)
    .join("\n\n");

  const others = hits
    .slice(top.length, top.length + 8)
    .map((h) => `- ${h.title} — ${h.url} (${h.engine})`)
    .join("\n");

  return `${detailed}${others ? `\n\n### Autres résultats\n${others}` : ""}`;
}

const SEARCH_TRIGGERS =
  /\b(cherche|recherche|google|actualit|news|derni[eè]re?s?\s+(info|nouvelle)|aujourd'hui|ce matin|en ce moment|cours de|prix de|m[ée]t[ée]o|qui est|c'est quoi.*20\d\d|20(2[5-9]|3\d))\b/i;

/** Détecte si une question nécessite une recherche web en temps réel. */
export function needsWebSearch(text: string): boolean {
  const t = (text || "").trim();
  if (!t || t.length < 4) return false;
  if (/^\//.test(t) && !/^\/search\b/i.test(t)) return false;
  return SEARCH_TRIGGERS.test(t);
}