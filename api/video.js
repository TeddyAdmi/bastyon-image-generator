function parseImageData(imageBase64) {
  const value = String(imageBase64 || "");
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);

  if (!match) {
    throw new Error("Изображение должно быть передано в формате data:image/...;base64,...");
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");

  const extensionMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
  };

  return {
    mimeType,
    extension: extensionMap[mimeType] || "png",
    buffer: Buffer.from(base64, "base64")
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const prompt = body.prompt;
    const imageBase64 = body.imageBase64;
    const duration = body.duration ?? 5;
    const resolution = body.resolution ?? "720P";

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({
        success: false,
        error: "Введите описание движения для видео."
      });
    }

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: "Изображение не загружено."
      });
    }

    if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
      return res.status(503).json({
        success: false,
        error: "Cloudflare Workers AI ещё не настроен. Проверьте CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в Vercel."
      });
    }

    const source = String(imageBase64).trim();

    // Vercel Functions have a 4.5 MB request-body limit.
    // Normal editor images should be URLs, so this mainly protects accidental huge data URLs.
    if (source.length > 4_000_000) {
      return res.status(413).json({
        success: false,
        error: "Изображение слишком большое для Vercel API. Используйте изображение из генератора или уменьшите его размер."
      });
    }

    let imageUrl = source;

    if (source.startsWith("data:image/")) {
      const { mimeType, extension, buffer } = parseImageData(source);

      if (!buffer.length) {
        return res.status(400).json({
          success: false,
          error: "Не удалось прочитать исходное изображение."
        });
      }

      const { put } = await import("@vercel/blob");

      const blob = await put(
        "miya-video-input/" +
          Date.now() +
          "-" +
          Math.random().toString(36).slice(2) +
          "." +
          extension,
        buffer,
        {
          access: "public",
          contentType: mimeType,
          addRandomSuffix: false
        }
      );

      imageUrl = blob.url;
    } else if (!isHttpUrl(source)) {
      return res.status(400).json({
        success: false,
        error: "Изображение должно быть URL или data:image/...;base64,..."
      });
    }

    const safeDuration = Math.min(15, Math.max(2, Number(duration) || 5));
    const safeResolution = resolution === "1080P" ? "1080P" : "720P";

    const cloudflareUrl =
      "https://api.cloudflare.com/client/v4/accounts/" +
      process.env.CLOUDFLARE_ACCOUNT_ID +
      "/ai/run";

    console.log("Wan 2.7 request", {
      imageType: source.startsWith("data:image/") ? "blob" : "url",
      duration: safeDuration,
      resolution: safeResolution
    });

    const response = await fetch(cloudflareUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.CLOUDFLARE_API_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "alibaba/wan-2.7-i2v",
        input: {
          image: imageUrl,
          prompt: String(prompt).trim(),
          negative_prompt:
            "blurry, distorted face, extra limbs, deformed body, flicker, jitter, unstable background",
          duration: safeDuration,
          resolution: safeResolution,
          watermark: false
        }
      })
    });

    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("Cloudflare non-JSON response", response.status, responseText.slice(0, 1000));
      return res.status(502).json({
        success: false,
        error: "Cloudflare вернул не JSON.",
        status: response.status
      });
    }

    if (!response.ok || data.success === false) {
      const code = data.errors && data.errors[0] ? data.errors[0].code : null;
      const message =
        data.errors && data.errors[0]
          ? data.errors[0].message
          : data.error || "Cloudflare Workers AI не смог создать видео.";

      let userMessage = message;

      if (code === 3036 || /daily free allocation|10,000 neurons/i.test(message)) {
        userMessage = "Бесплатный дневной лимит Cloudflare Workers AI исчерпан. Попробуйте позже.";
      } else if (code === 3040 || /capacity/i.test(message)) {
        userMessage = "Cloudflare сейчас перегружен. Попробуйте ещё раз через несколько минут.";
      }

      console.error("Cloudflare Wan 2.7 error", {
        status: response.status,
        code,
        message
      });

      return res.status(response.status || 502).json({
        success: false,
        error: userMessage,
        cloudflareCode: code
      });
    }

    const videoUrl = data.result && data.result.video;

    if (!videoUrl) {
      console.error("Cloudflare response without video", data);
      return res.status(502).json({
        success: false,
        error: "Cloudflare завершил запрос, но не вернул ссылку на видео."
      });
    }

    return res.status(200).json({
      success: true,
      videoUrl,
      provider: "Cloudflare Workers AI",
      model: "Wan 2.7 I2V",
      duration: safeDuration,
      resolution: safeResolution
    });
  } catch (error) {
    console.error("Video API error:", error);

    return res.status(500).json({
      success: false,
      error: error && error.message ? error.message : "Ошибка видеогенерации."
    });
  }
}
