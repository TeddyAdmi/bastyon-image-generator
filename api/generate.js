export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const {
      prompt,
      ratio = "1:1",
      model = "flux-dev",
      quality = "auto",
      size = "auto",
      outputFormat = "png"
    } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: "Введите описание изображения"
      });
    }

    const selectedModel = String(model || "flux-dev").toLowerCase();

    // Premium model: OpenAI GPT-Image-2.
    // The API key stays server-side in Vercel Environment Variables.
    if (selectedModel === "gpt-image-2") {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({
          success: false,
          error: "GPT-Image-2 пока не подключён. Добавьте OPENAI_API_KEY в Vercel → Settings → Environment Variables."
        });
      }

      const sizeMap = {
        "1:1": "1024x1024",
        "16:9": "1536x1024",
        "9:16": "1024x1536"
      };

      const requestedSize =
        size && ["1024x1024", "1024x1536", "1536x1024", "auto"].includes(size)
          ? size
          : (sizeMap[ratio] || "auto");

      const requestedQuality =
        ["auto", "low", "medium", "high"].includes(quality)
          ? quality
          : "auto";

      const requestedFormat =
        ["png", "jpeg", "webp"].includes(outputFormat)
          ? outputFormat
          : "png";

      const response = await fetch(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-image-2",
            prompt: prompt.trim(),
            size: requestedSize,
            quality: requestedQuality,
            output_format: requestedFormat
          })
        }
      );

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        return res.status(502).json({
          success: false,
          error: "OpenAI вернул не JSON",
          status: response.status
        });
      }

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          error: data?.error?.message || "Ошибка GPT-Image-2",
          details: data?.error || data
        });
      }

      const b64 = data?.data?.[0]?.b64_json;

      if (!b64) {
        return res.status(502).json({
          success: false,
          error: "GPT-Image-2 не вернул изображение"
        });
      }

      return res.status(200).json({
        success: true,
        imageUrl: `data:image/${requestedFormat};base64,${b64}`,
        prompt: prompt.trim(),
        ratio,
        size: requestedSize,
        quality: requestedQuality,
        outputFormat: requestedFormat,
        provider: "OpenAI",
        model: "GPT-Image-2",
        historyPersistent: false
      });
    }

    // Free fallback/current provider: Flux Dev through PixelSter.
    const response = await fetch(
      "https://ahm7xmakki.com/api/tti",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          ratio
        })
      }
    );

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        success: false,
        error: "PixelSter вернул не JSON",
        status: response.status,
        response: text.substring(0, 1000)
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.error || "Ошибка PixelSter",
        details: data
      });
    }

    if (!data.imageUrl) {
      return res.status(502).json({
        success: false,
        error: "PixelSter не вернул imageUrl",
        response: data
      });
    }

    return res.status(200).json({
      success: true,
      imageUrl: data.imageUrl,
      prompt: data.prompt || prompt,
      ratio: data.ratio || ratio,
      size: "provider",
      quality: "provider",
      outputFormat: "provider",
      provider: "PixelSter",
      model: "Flux Dev",
      historyPersistent: true
    });
  } catch (error) {
    console.error("Generate error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Ошибка генерации"
    });
  }
}