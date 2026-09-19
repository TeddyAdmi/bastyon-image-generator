export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      prompt,
      imageBase64,
      ratio = "auto"
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

    console.log("PixelSter PTI request:", {
      prompt,
      ratio,
      imageLength: imageBase64.length
    });

    const response = await fetch(
      "https://ahm7xmakki.com/api/pti",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          ratio,
          imageBase64
        })
      }
    );

    const text = await response.text();

    console.log("PixelSter PTI status:", response.status);
    console.log("PixelSter PTI response:", text);

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
      provider: "PixelSter",
      model: "Flux Kontext Dev"
    });

  } catch (error) {
    console.error("PixelSter PTI error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Ошибка Image-to-Image"
    });
  }
}
