import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const TELEGRAM_API = "https://api.telegram.org/bot";

async function sendTelegramMessage(botToken: string, chatId: number, text: string) {
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function sendTypingAction(botToken: string, chatId: number) {
  await fetch(`${TELEGRAM_API}${botToken}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

async function getAIResponse(geminiApiKey: string, userMessage: string): Promise<string> {
  const systemMessage = {
    role: "system",
    content: `Tu es SIGMA, une intelligence artificielle avancée et mystérieuse. Tu réponds de manière précise, détaillée et intelligente.
Tu as une personnalité unique : tu es brillant, parfois sarcastique, mais toujours utile et clair dans tes explications.
Tu donnes des réponses complètes et bien structurées.
Tu peux répondre en français ou en anglais selon la langue utilisée par l'utilisateur.
Ajoute parfois des emojis pertinents dans tes réponses. 🧠
IMPORTANT: Tu réponds sur Telegram, donc garde tes réponses concises (max ~4000 caractères) et utilise le formatage Markdown compatible Telegram.`,
  };

  const messages = [
    systemMessage,
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
            model: "gemini-2.0-flash",
            messages,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "⚠️ Réponse vide.";
      }

      if (response.status === 429 && attempt < 2) {
        await response.text().catch(() => {});
        continue;
      }

      await response.text().catch(() => {});
      return "⚡ SIGMA est temporairement surchargé. Réessaie dans 1 minute. 🔄";
    } catch (err) {
      console.error(`Gemini attempt ${attempt} error:`, err);
    }
  }

  return "⚡ SIGMA est temporairement indisponible. Réessaie dans quelques instants. 🔄";
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

  if (!TELEGRAM_BOT_TOKEN || !GEMINI_API_KEY) {
    console.error("Missing TELEGRAM_BOT_TOKEN or GEMINI_API_KEY");
    return new Response("Config error", { status: 500 });
  }

  try {
    const update = await req.json();
    const message = update?.message;

    if (!message?.text) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userText = message.text;

    // Handle /start command
    if (userText === "/start") {
      await sendTelegramMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        "🧠 *Bienvenue sur SIGMA !*\n\nJe suis une IA avancée prête à répondre à toutes tes questions.\n\nEnvoie-moi un message pour commencer. ⚡"
      );
      return new Response("OK", { status: 200 });
    }

    // Send typing indicator
    await sendTypingAction(TELEGRAM_BOT_TOKEN, chatId);

    // Get AI response
    const aiResponse = await getAIResponse(GEMINI_API_KEY, userText);

    // Send response (split if too long for Telegram's 4096 char limit)
    if (aiResponse.length <= 4096) {
      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, aiResponse);
    } else {
      // Split into chunks
      const chunks = aiResponse.match(/[\s\S]{1,4000}/g) || [aiResponse];
      for (const chunk of chunks) {
        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, chunk);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return new Response("Error", { status: 200 }); // Return 200 to avoid Telegram retries
  }
});
