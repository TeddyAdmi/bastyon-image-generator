import { editImage } from "./_lib/image-providers.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const {
      prompt,
      imageBase64,
      ratio = "1:1",
      model = "auto",
      quality = "auto",
      size = "auto",
      outputFormat = "png"
    } = req.body || {};

    const cleanPrompt = String(prompt || "").trim();
    const image = String(imageBase64 || "").trim();

    if (!cleanPrompt) {
      return res.status(400).json({
        success: false,
        error: "Введите описание изменения"
      });
    }

    if (!image) {
      return res.status(400).json({
        success: false,
        error: "Изображение не загружено"
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

    return res.status(503).json({
      success: false,
      error: error.message || "Редактор временно недоступен. Проверьте выбранный провайдер."
    });
  }
}
