export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const {
      prompt,
      imageBase64,
      ratio = "auto",
      model = "flux-dev",
      quality = "auto",
      size = "auto",
      outputFormat = "png"
    } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: "Введите описание изменения"
      });
    }

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: "Изображение не загружено"
      });
    }

    if (imageBase64.length > 4_000_000) {
      return res.status(413).json({
        success: false,
        error: "Изображение слишком большое. Выберите файл до примерно 3 MB."
      });
    }

    const selectedModel = String(model || "flux-dev").toLowerCase();

    // GPT-Image-2 editing. Requires OPENAI_API_KEY in Vercel.
    if (selectedModel === "gpt-image-2") {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({
          success: false,
          error: "GPT-Image-2 пока не подключён. Добавьте OPENAI_API_KEY в Vercel → Settings → Environment Variables."
        });
      }

      const requestedSize =
        size && ["1024x1024", "1024x1536", "1536x1024", "auto"].includes(size)
          ? size
          : "auto";

      const requestedQuality =
        ["auto", "low", "medium", "high"].includes(quality)
          ? quality
          : "auto";

      const requestedFormat =
        ["png", "jpeg", "webp"].includes(outputFormat)
          ? outputFormat
          : "png";

      const raw = imageBase64.includes(",")
        ? imageBase64.split(",")[1]
        : imageBase64;

      const inputBuffer = Buffer.from(raw, "base64");
      const imageBlob = new Blob([inputBuffer], { type: "image/png" });

      const form = new FormData();
      form.append("model", "gpt-image-2");
      form.append("prompt", prompt.trim());
      form.append("size", requestedSize);
      form.append("quality", requestedQuality);
      form.append("output_format", requestedFormat);
      form.append("image", imageBlob, "input.png");

      const response = await fetch(
        "https://api.openai.com/v1/images/edits",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: form
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
          error: "GPT-Image-2 не вернул отредактированное изображение"
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

    // Free editor: Flux Kontext Dev through PixelSter.
    const response = await fetch(
      "https://ahm7xmakki.com/api/pti",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          ratio,
          imageBase64
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
      model: "Flux Kontext Dev",
      historyPersistent: true
    });
  } catch (error) {
    console.error("Edit error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Ошибка редактирования изображения"
    });
  }
}