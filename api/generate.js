```javascript
export default async function handler(req, res) {
  // Только POST
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      prompt,
      model = "gemini-3.1-flash-image",
      width = 1024,
      height = 1024,
      quality = "medium"
    } = req.body || {};

    // -----------------------------------------
    // ПРОВЕРКА ПРОМТА
    // -----------------------------------------

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        success: false,
        error: "Промт пустой."
      });
    }

    const cleanPrompt = prompt.trim();

    if (!cleanPrompt) {
      return res.status(400).json({
        success: false,
        error: "Промт пустой."
      });
    }

    if (cleanPrompt.length > 32000) {
      return res.status(400).json({
        success: false,
        error: "Промт слишком длинный. Максимум 32000 символов."
      });
    }

    // -----------------------------------------
    // GEMINI API KEY
    // -----------------------------------------

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error:
          "GEMINI_API_KEY не настроен в Vercel Environment Variables."
      });
    }

    // -----------------------------------------
    // МОДЕЛИ
    // -----------------------------------------

    const models = {
      "gpt-image-2": "gemini-3.1-flash-image",
      flux: "gemini-3.1-flash-image",
      zimage: "gemini-3.1-flash-image",
      dream: "gemini-3.1-flash-image",
      seedream: "gemini-3.1-flash-image",
      qwen: "gemini-3.1-flash-image",

      "gemini": "gemini-3.1-flash-image",
      "gemini-3.1": "gemini-3.1-flash-image",
      "gemini-3.1-flash-image": "gemini-3.1-flash-image"
    };

    const selectedModel =
      models[model] || "gemini-3.1-flash-image";

    // -----------------------------------------
    // РАЗМЕРЫ
    // -----------------------------------------

    let imageWidth = Number(width);
    let imageHeight = Number(height);

    if (!Number.isFinite(imageWidth)) {
      imageWidth = 1024;
    }

    if (!Number.isFinite(imageHeight)) {
      imageHeight = 1024;
    }

    imageWidth = Math.max(
      256,
      Math.min(4096, Math.round(imageWidth))
    );

    imageHeight = Math.max(
      256,
      Math.min(4096, Math.round(imageHeight))
    );

    // -----------------------------------------
    // ОПРЕДЕЛЯЕМ ASPECT RATIO
    // -----------------------------------------

    const ratio = imageWidth / imageHeight;

    let aspectRatio = "1:1";

    const ratios = [
      { value: "1:1", ratio: 1 },
      { value: "16:9", ratio: 16 / 9 },
      { value: "9:16", ratio: 9 / 16 },
      { value: "4:3", ratio: 4 / 3 },
      { value: "3:4", ratio: 3 / 4 },
      { value: "4:5", ratio: 4 / 5 },
      { value: "5:4", ratio: 5 / 4 },
      { value: "3:2", ratio: 3 / 2 },
      { value: "2:3", ratio: 2 / 3 },
      { value: "21:9", ratio: 21 / 9 }
    ];

    let closestDifference = Infinity;

    for (const item of ratios) {
      const difference =
        Math.abs(ratio - item.ratio);

      if (difference < closestDifference) {
        closestDifference = difference;
        aspectRatio = item.value;
      }
    }

    // -----------------------------------------
    // IMAGE SIZE
    // -----------------------------------------
    //
    // Gemini использует:
    //
    // 512px
    // 1K
    // 2K
    // 4K
    //
    // Здесь размер выбирается автоматически
    // исходя из width / height.
    //

    const largestSide =
      Math.max(imageWidth, imageHeight);

    let imageSize = "1K";

    if (largestSide <= 768) {
      imageSize = "0.5K";
    } else if (largestSide <= 1536) {
      imageSize = "1K";
    } else if (largestSide <= 3072) {
      imageSize = "2K";
    } else {
      imageSize = "4K";
    }

    // -----------------------------------------
    // QUALITY
    // -----------------------------------------
    //
    // Gemini 3.1 Flash Image не использует
    // quality=low/medium/high так же,
    // как Pollinations.
    //
    // Поэтому quality переводим в размер.
    //

    if (quality === "low") {
      imageSize = "0.5K";
    }

    if (quality === "medium") {
      if (largestSide <= 1536) {
        imageSize = "1K";
      } else {
        imageSize = "2K";
      }
    }

    if (quality === "high") {
      if (largestSide <= 1536) {
        imageSize = "2K";
      } else {
        imageSize = "4K";
      }
    }

    // -----------------------------------------
    // GEMINI API
    // -----------------------------------------

    const apiUrl =
      `https://generativelanguage.googleapis.com/v1/models/${selectedModel}:generateContent`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: cleanPrompt
            }
          ]
        }
      ],

      generationConfig: {
        responseModalities: ["IMAGE"]
      }
    };

    // -----------------------------------------
    // ВАЖНО:
    //
    // Добавляем параметры изображения.
    // -----------------------------------------

    requestBody.generationConfig.imageConfig = {
      aspectRatio: aspectRatio,
      imageSize: imageSize
    };

    // -----------------------------------------
    // ОТПРАВЛЯЕМ ЗАПРОС
    // -----------------------------------------

    const response = await fetch(apiUrl, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },

      body: JSON.stringify(requestBody)
    });

    const responseText =
      await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        "Gemini returned non-JSON:",
        responseText.slice(0, 2000)
      );

      return res.status(502).json({
        success: false,
        error:
          "Gemini вернул некорректный ответ."
      });
    }

    // -----------------------------------------
    // ОШИБКА GEMINI
    // -----------------------------------------

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        response.status,
        data
      );

      let errorMessage =
        "Ошибка генерации изображения Gemini.";

      if (data?.error?.message) {
        errorMessage =
          data.error.message;
      }

      return res.status(response.status).json({
        success: false,
        error: errorMessage,
        model: selectedModel
      });
    }

    // -----------------------------------------
    // ИЩЕМ IMAGE PART
    // -----------------------------------------

    const candidates =
      data?.candidates || [];

    let imagePart = null;

    for (const candidate of candidates) {
      const parts =
        candidate?.content?.parts || [];

      for (const part of parts) {
        if (
          part?.inlineData?.data ||
          part?.inline_data?.data
        ) {
          imagePart = part;
          break;
        }
      }

      if (imagePart) {
        break;
      }
    }

    // -----------------------------------------
    // НЕ НАШЛИ КАРТИНКУ
    // -----------------------------------------

    if (!imagePart) {
      console.error(
        "Gemini response without image:",
        JSON.stringify(data).slice(0, 5000)
      );

      return res.status(502).json({
        success: false,
        error:
          "Gemini не вернул изображение. Возможно, запрос был заблокирован или модель вернула только текст."
      });
    }

    // -----------------------------------------
    // BASE64
    // -----------------------------------------

    const inlineData =
      imagePart.inlineData ||
      imagePart.inline_data;

    const base64 =
      inlineData.data;

    const mimeType =
      inlineData.mimeType ||
      inlineData.mime_type ||
      "image/png";

    // -----------------------------------------
    // ГОТОВЫЙ ОТВЕТ
    // -----------------------------------------

    return res.status(200).json({
      success: true,

      model: selectedModel,

      width: imageWidth,

      height: imageHeight,

      aspectRatio: aspectRatio,

      imageSize: imageSize,

      quality: quality,

      image: {
        mime: mimeType,
        data: base64
      }
    });

  } catch (error) {
    console.error(
      "Generate handler error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Внутренняя ошибка сервера."
    });
  }
}
```
