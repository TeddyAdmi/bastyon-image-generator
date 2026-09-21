import { generateImage, getProviderStatus } from "./_lib/image-providers.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      providers: getProviderStatus(),
      architecture: "unified-image-providers"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const {
      prompt,
      ratio = "1:1",
      model = "or-nano-banana-2",
      quality = "auto",
      size = "auto",
      outputFormat = "png"
    } = req.body || {};

    const cleanPrompt = String(prompt || "").trim();

    if (!cleanPrompt) {
      return res.status(400).json({
        success: false,
        error: "Введите описание изображения"
      });
    }

    const result = await generateImage({
      prompt: cleanPrompt,
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
      architecture: "unified-image-providers",
      historyPersistent: !String(result.imageUrl).startsWith("data:")
    });
  } catch (error) {
    console.error("Generate error:", error);

    return res.status(502).json({
      success: false,
      error: error.message || "Ошибка генерации изображения"
    });
  }
}
