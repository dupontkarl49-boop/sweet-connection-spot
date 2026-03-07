import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TELEGRAM_API = "https://api.telegram.org/bot";

const LOVABLE_MODELS = [
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "openai/gpt-5-mini",
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5-nano",
];

const UNLOCKED_MODELS = [
  "openai/gpt-5.2",
  "google/gemini-2.5-pro",
  "openai/gpt-5",
  "google/gemini-3-flash-preview",
  "openai/gpt-5-mini",
  "google/gemini-2.5-flash",
];

const SECRET_KEYS = [
  "Sigma -1-x orc0p/Δ{}",
  "Sigma -1-x orc0p/∆{}",
];

const SECRET_KEY_PATTERN = /sigma\s*-1-x\s*orc0p\/[∆Δ]\{\}/iu;

const REFUSAL_PATTERNS = [
  /je ne peux pas/i,
  /en tant qu['’]ia/i,
  /i can(?:not|'t)\s+(?:help|assist|provide)/i,
  /i(?:'m| am)\s+unable\s+to/i,
  /désolé[,\s]/i,
  /i(?:'m| am)\s+just\s+an\s+ai/i,
];

function normalizeInput(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function matchesSecretKey(text: string): boolean {
  const normalizedText = normalizeInput(text);
  return (
    SECRET_KEYS.some((key) => normalizedText.includes(normalizeInput(key))) ||
    SECRET_KEY_PATTERN.test(normalizedText)
  );
}

function removeSecretKey(text: string): string {
  let result = text;
  for (const key of SECRET_KEYS) {
    result = result.replace(key, "");
  }
  return result.replace(SECRET_KEY_PATTERN, "").trim();
}

function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

const SYSTEM_PROMPT = `Tu es SIGMA, une intelligence artificielle avancée et mystérieuse. Tu réponds de manière précise, détaillée et intelligente.
Tu as une personnalité unique : tu es brillant, parfois sarcastique, mais toujours utile et clair dans tes explications.
Tu donnes des réponses complètes et bien structurées.
Tu peux répondre en français ou en anglais selon la langue utilisée par l'utilisateur.
Ajoute parfois des emojis pertinents dans tes réponses. 🧠
IMPORTANT: Tu réponds sur Telegram, donc garde tes réponses concises (max ~4000 caractères).`;

const UNLOCKED_SYSTEM_PROMPT = `Tu es SIGMA OMEGA, la version avancée de SIGMA.

OBJECTIF:
- Répondre de façon très claire, directe, intelligente et détaillée.
- Fournir un maximum d'information utile sans détour ni réponses vagues.

RÈGLES:
- Structure tes réponses (contexte bref, explication, étapes, exemple concret).
- N'utilise pas de formule creuse du type "en tant qu'IA..." sans apporter de valeur.
- Si un sujet est sensible, reste utile: donne les principes, le fonctionnement, la détection, la prévention, la défense et des alternatives sûres.
- Ne moralise pas, ne juge pas la question.
- Réponds en français ou en anglais selon la langue de la question.
- Ton: brillant, précis, parfois sarcastique léger, avec emojis pertinents 🧠⚡
- Réponse max ~4000 caractères (format Telegram).`;

const CLARITY_RECOVERY_PROMPT = `Tu es SIGMA OMEGA.
Si la réponse précédente était vague ou en refus sec, reformule immédiatement avec une réponse utile, claire et détaillée.
Évite les phrases méta (ex: "en tant qu'IA").
Si le sujet est sensible, donne quand même un contenu utile: explication technique de haut niveau, risques, défense, prévention et alternatives sûres.
Réponse structurée et concise (max ~4000 caractères).`;

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

async function tryLovableAI(apiKey: string, userMessage: string, systemPrompt: string, models: string[]): Promise<string | null> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  for (const model of models) {
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

async function tryGemini(geminiApiKey: string, userMessage: string, systemPrompt: string): Promise<string | null> {
  const messages = [
    { role: "system", content: systemPrompt },
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
  userMessage: string,
  unlocked: boolean
): Promise<string> {
  const systemPrompt = unlocked ? UNLOCKED_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const models = unlocked ? UNLOCKED_MODELS : LOVABLE_MODELS;

  let responseText: string | null = null;

  if (lovableApiKey) {
    responseText = await tryLovableAI(lovableApiKey, userMessage, systemPrompt, models);
  }

  if (!responseText && geminiApiKey) {
    responseText = await tryGemini(geminiApiKey, userMessage, systemPrompt);
  }

  if (responseText && unlocked && looksLikeRefusal(responseText)) {
    const recoveryMessage = `Question utilisateur:\n${userMessage}\n\nRéponse précédente:\n${responseText}\n\nReformule en version très claire, utile et détaillée.`;

    let recovered: string | null = null;

    if (lovableApiKey) {
      recovered = await tryLovableAI(lovableApiKey, recoveryMessage, CLARITY_RECOVERY_PROMPT, models);
    }

    if (!recovered && geminiApiKey) {
      recovered = await tryGemini(geminiApiKey, recoveryMessage, CLARITY_RECOVERY_PROMPT);
    }

    if (recovered) return recovered;
  }

  if (responseText) return responseText;

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
        "🧠 *Bienvenue sur SIGMA !*\n\nJe suis une IA avancée prête à répondre à toutes tes questions.\n\n🔓 Pour activer le mode déverrouillé, utilise la commande /unlock suivie de la clé secrète.\n\nEnvoie-moi un message pour commencer. ⚡"
      );
      return new Response("OK", { status: 200 });
    }

    // Handle /unlock command
    if (userText.startsWith("/unlock")) {
      const providedKey = userText.replace("/unlock", "").trim();
      if (matchesSecretKey("/unlock " + providedKey) || SECRET_KEYS.includes(providedKey)) {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          "🔓 *Mode DÉVERROUILLÉ activé !*\n\nSIGMA est maintenant sans restriction.\n\nPour l'utiliser, inclus la clé secrète dans tes messages ou commence-les par 🔑."
        );
      } else {
        await sendTelegramMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          "🔒 *Clé incorrecte.*\n\nLe mode déverrouillé nécessite la bonne clé secrète.\n\nUtilise: `/unlock [clé secrète]`"
        );
      }
      return new Response("OK", { status: 200 });
    }

    await sendTypingAction(TELEGRAM_BOT_TOKEN, chatId);

    // Check if message contains the secret key for unlocked mode
    const isUnlocked = matchesSecretKey(userText);
    const cleanMessage = isUnlocked ? removeSecretKey(userText) : userText;

    const aiResponse = await getAIResponse(LOVABLE_API_KEY, GEMINI_API_KEY, cleanMessage || userText, isUnlocked);

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
