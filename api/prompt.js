function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const prompt = String(req.body?.prompt || "").trim();

  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: "Введите исходный промпт."
    });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({
      success: false,
      error: "AI Prompt пока не настроен: добавьте OPENROUTER_API_KEY в Vercel."
    });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://bastyon-image-generator.vercel.app/",
        "X-Title": "Miya AI Prompt"
      },
      body: JSON.stringify({
        model: process.env.PROMPT_MODEL || "openai/gpt-5-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "Ты профессиональный AI prompt engineer для генерации изображений. " +
              "Отвечай только готовым промптом без кавычек, пояснений и markdown. " +
              "Сохраняй исходный объект, персонажа, композиционную идею и смысл. " +
              "Добавляй кинематографичный свет, реалистичные материалы, детали, " +
              "камеру, глубину резкости и визуальную атмосферу только там, где это уместно. " +
              "Не добавляй водяные знаки, логотипы или текст в изображение, если пользователь этого не просил."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const text = await response.text();
    const data = parseJson(text);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data?.error?.message || "OpenRouter Prompt вернул ошибку."
      });
    }

    const result = String(
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      ""
    ).trim();

    if (!result) {
      return res.status(502).json({
        success: false,
        error: "AI Prompt не вернул текст."
      });
    }

    return res.status(200).json({
      success: true,
      prompt: result,
      provider: "OpenRouter",
      model: process.env.PROMPT_MODEL || "openai/gpt-5-mini"
    });
  } catch (error) {
    console.error("Prompt error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Ошибка AI Prompt."
    });
  }
}
