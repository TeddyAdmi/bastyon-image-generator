import { editImage } from "./_lib/image-providers.js";

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function urlToDataUrl(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Miya-AI/1.0" }
  });

  if (!response.ok) {
    throw new Error("Не удалось получить изображение с URL: HTTP " + response.status);
  }

  const contentType = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!contentType.startsWith("image/")) {
    throw new Error("Указанный URL не вернул изображение.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length > 8_000_000) {
    throw new Error("Изображение слишком большое. Выберите файл до примерно 6 MB.");
  }

  return "data:" + contentType + ";base64," + bytes.toString("base64");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const cleanPrompt = String(body.prompt || "").trim();
    let image = String(body.imageBase64 || "").trim();
    const imageUrl = String(body.imageUrl || "").trim();

    const ratio = body.ratio || "1:1";
    const model = body.model || "auto";
    const quality = body.quality || "auto";
    const size = body.size || "auto";
    const outputFormat = body.outputFormat || "png";

    if (!cleanPrompt) {
      return res.status(400).json({
        success: false,
        error: "Введите описание изменения."
      });
    }

    // Prefer an already supplied data URL. Otherwise download the public
    // generated image on the server, avoiding browser CORS restrictions.
    if (!image && isHttpUrl(imageUrl)) {
      image = await urlToDataUrl(imageUrl);
    }

    if (!image) {
      return res.status(400).json({
        success: false,
        error: "Изображение не загружено."
      });
    }

    if (image.length > 8_000_000) {
      return res.status(413).json({
        success: false,
        error: "Изображение слишком большое. Выберите файл до примерно 6 MB."
      });
    }

    const result = await editImage({
      prompt: cleanPrompt,
      imageBase64: image,
      ratio,
      model,
      quality,
      size,
      outputFormat
    });

    return res.status(200).json({
      success: true,
      imageUrl: result.imageUrl,
      prompt: cleanPrompt,
      ratio,
      size,
      quality,
      outputFormat,
      provider: result.provider,
      model: result.model,
      architecture: "unified-image-providers"
    });
  } catch (error) {
    console.error("Edit error:", error);

    const message =
      typeof error?.message === "string" ? error.message :
      typeof error === "string" ? error :
      error ? JSON.stringify(error) :
      "Редактор временно недоступен.";

    return res.status(503).json({
      success: false,
      error: message
    });
  }
}
