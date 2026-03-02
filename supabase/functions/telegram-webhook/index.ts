import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TELEGRAM_API = "https://api.telegram.org/bot";

const LOVABLE_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5-nano",
  "openai/gpt-5-mini",
];

const SYSTEM_PROMPT = `Tu es SIGMA, une intelligence artificielle avancée et mystérieuse. Tu réponds de manière précise, détaillée et intelligente.
Tu as une personnalité unique : tu es brillant, parfois sarcastique, mais toujours utile et clair dans tes explications.
Tu donnes des réponses complètes et bien structurées.
Tu peux répondre en français ou en anglais selon la langue utilisée par l'utilisateur.
Ajoute parfois des emojis pertinents dans tes réponses. 🧠
IMPORTANT: Tu réponds sur Telegram, donc garde tes réponses concises (max ~4000 caractères).`;

function extractAssistantText(payload: any): string | null {
  const text = payload?.choices?.[0]?.message?.content;
  return typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string) {
  const markdownResponse = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (markdownResponse.ok) return;

  const markdownError = await markdownResponse.text().catch(() => "");
  console.error("Telegram sendMessage markdown failed:", markdownResponse.status, markdownError);

  const plainResponse = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!plainResponse.ok) {
    const plainError = await plainResponse.text().catch(() => "");
    console.error("Telegram sendMessage plain failed:", plainResponse.status, plainError);
  }
}

async function sendTypingAction(botToken: string, chatId: number) {
  await fetch(`${TELEGRAM_API}${botToken}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

async function tryLovableAI(apiKey: string, userMessage: string): Promise<string | null> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  for (const model of LOVABLE_MODELS) {
    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = extractAssistantText(data);
        if (content) return content;
      } else {
        const errorBody = await response.text().catch(() => "");
        console.error(`Lovable AI model ${model} failed:`, response.status, errorBody.slice(0, 400));
        if (response.status === 401) break;
      }
    } catch (error) {
      console.error(`Lovable AI model ${model} error:`, error);
    }
  }

  return null;
}

async function tryGemini(geminiApiKey: string, userMessage: string): Promise<string | null> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }

    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${geminiApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const content = extractAssistantText(data);
        if (content) return content;
      } else {
        const errorBody = await response.text().catch(() => "");
        console.error(`Gemini attempt ${attempt} failed:`, response.status, errorBody.slice(0, 400));

        if (response.status === 429 && attempt < 2) {
          continue;
        }

        if (response.status !== 429) {
          return null;
        }
      }
    } catch (error) {
      console.error(`Gemini attempt ${attempt} exception:`, error);
    }
  }

  return null;
}

async function getAIResponse(
  lovableApiKey: string | undefined,
  geminiApiKey: string | undefined,
  userMessage: string
): Promise<string> {
  if (lovableApiKey) {
    const lovableResponse = await tryLovableAI(lovableApiKey, userMessage);
    if (lovableResponse) return lovableResponse;
  }

  if (geminiApiKey) {
    const geminiResponse = await tryGemini(geminiApiKey, userMessage);
    if (geminiResponse) return geminiResponse;
  }

  return "⚡ SIGMA est temporairement surchargé. Réessaie dans 1 minute. 🔄";
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

  if (!TELEGRAM_BOT_TOKEN) {
    console.error("Missing TELEGRAM_BOT_TOKEN");
    return new Response("Config error", { status: 500 });
  }

  if (!LOVABLE_API_KEY && !GEMINI_API_KEY) {
    console.error("Missing LOVABLE_API_KEY and GEMINI_API_KEY");
    return new Response("Config error", { status: 500 });
  }

  try {
    const update = await req.json();
    const message = update?.message ?? update?.edited_message;

    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userText = String(message.text).trim();

    if (userText === "/start") {
      await sendTelegramMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        "🧠 *Bienvenue sur SIGMA !*\n\nJe suis une IA avancée prête à répondre à toutes tes questions.\n\nEnvoie-moi un message pour commencer. ⚡"
      );
      return new Response("OK", { status: 200 });
    }

    await sendTypingAction(TELEGRAM_BOT_TOKEN, chatId);

    const aiResponse = await getAIResponse(LOVABLE_API_KEY, GEMINI_API_KEY, userText);

    if (aiResponse.length <= 4096) {
      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, aiResponse);
    } else {
      const chunks = aiResponse.match(/[\s\S]{1,4000}/g) || [aiResponse];
      for (const chunk of chunks) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, chunk);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return new Response("Error", { status: 200 });
  }
});
