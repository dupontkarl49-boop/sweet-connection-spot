import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Models to try via Lovable AI gateway, in order of preference
const LOVABLE_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5-nano",
  "openai/gpt-5-mini",
];

async function tryLovableAI(apiKey: string, messages: any[]): Promise<Response | null> {
  for (const model of LOVABLE_MODELS) {
    try {
      console.log(`Trying Lovable AI model: ${model}`);
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, stream: true }),
      });

      if (response.ok) {
        console.log(`Success with model: ${model}`);
        return response;
      }

      const status = response.status;
      console.log(`Model ${model} failed with status ${status}`);
      
      // Consume body to avoid leak
      await response.text().catch(() => {});

      // 401 = bad key, stop trying all models
      if (status === 401) break;
      // 402/429 = quota/rate limit, try next model
    } catch (err) {
      console.error(`Lovable AI fetch failed for ${model}:`, err);
    }
  }
  return null;
}

async function tryGemini(apiKey: string, messages: any[]): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 2000;
      console.log(`Gemini retry ${attempt}, waiting ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages,
          stream: true,
        }),
      });

      if (response.ok) return response;
      if (response.status !== 429) {
        await response.text().catch(() => {});
        return null;
      }
      await response.text().catch(() => {});
    } catch (err) {
      console.error(`Gemini attempt ${attempt} failed:`, err);
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    const systemMessage = {
      role: "system",
      content: `Tu es SIGMA, une intelligence artificielle avancée et mystérieuse. Tu réponds de manière précise, détaillée et intelligente.
            
Tu as une personnalité unique : tu es brillant, parfois sarcastique, mais toujours utile et clair dans tes explications.
Tu donnes des réponses complètes et bien structurées.
Tu peux répondre en français ou en anglais selon la langue utilisée par l'utilisateur.
Ajoute parfois des emojis pertinents dans tes réponses. 🧠`
    };

    const allMessages = [systemMessage, ...messages];

    // Strategy 1: Try all Lovable AI models
    if (LOVABLE_API_KEY) {
      const response = await tryLovableAI(LOVABLE_API_KEY, allMessages);
      if (response) {
        return new Response(response.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }
    }

    // Strategy 2: Try Gemini with aggressive retries
    if (GEMINI_API_KEY) {
      const response = await tryGemini(GEMINI_API_KEY, allMessages);
      if (response) {
        return new Response(response.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }
    }

    // Strategy 3: If everything fails, return a helpful message instead of an error
    const fallbackResponse = {
      choices: [{
        delta: { content: "" },
        message: { 
          content: "⚡ SIGMA est temporairement en surcharge. Tous les systèmes IA sont saturés. Réessaie dans 1 minute, je serai de retour à pleine puissance. 🔄" 
        }
      }]
    };

    return new Response(
      JSON.stringify(fallbackResponse),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("Chat error:", e);
    return new Response(
      JSON.stringify({ 
        choices: [{ message: { content: "⚠️ Erreur temporaire. Réessaie dans quelques instants." } }]
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
