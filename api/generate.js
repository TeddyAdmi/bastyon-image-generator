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
      model = "flux",
      width = 1024,
      height = 1024,
      quality = "medium"
    } = req.body || {};

    // Проверяем промт
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

    /*
     * Актуальные модели Pollinations.
     *
     * Важно:
     * frontend использует короткие названия,
     * здесь они превращаются в реальные ID.
     */
    const models = {
      flux: "black-forest-labs/flux.1-schnell",

      "gpt-image-2": "openai/gpt-image-2",

      zimage: "tongyi-mai/z-image-turbo",

      dream: "lykon/dreamshaper-8-lcm",

      seedream: "bytedance/seedream-4.0",

      qwen: "qwen/qwen-image"
    };

    const selectedModel =
      models[model] || models.flux;


    /*
     * Разрешённые значения качества.
     */
    const allowedQuality = [
      "low",
      "medium",
      "high"
    ];

    const selectedQuality =
      allowedQuality.includes(quality)
        ? quality
        : "medium";


    /*
     * Безопасно приводим размеры.
     */
    let imageWidth = Number(width);
    let imageHeight = Number(height);

    if (!Number.isFinite(imageWidth)) {
      imageWidth = 1024;
    }

    if (!Number.isFinite(imageHeight)) {
      imageHeight = 1024;
    }


    /*
     * Ограничения.
     */
    imageWidth = Math.max(
      256,
      Math.min(1536, Math.round(imageWidth))
    );

    imageHeight = Math.max(
      256,
      Math.min(1536, Math.round(imageHeight))
    );


    /*
     * Большинство моделей лучше работают
     * с размерами, кратными 16.
     */
    imageWidth =
      Math.round(imageWidth / 16) * 16;

    imageHeight =
      Math.round(imageHeight / 16) * 16;


    /*
     * Очень важный момент:
     *
     * НЕ переписываем пользовательский промт.
     * НЕ добавляем случайные описания.
     *
     * Передаём именно то, что пользователь написал
     * или продиктовал.
     */
    const finalPrompt = cleanPrompt;


    /*
     * Pollinations OpenAI-compatible API.
     */
    const apiUrl =
      "https://gen.pollinations.ai/v1/images/generations";


    /*
     * API key хранится только на сервере Vercel.
     */
    const apiKey =
      process.env.POLLINATIONS_KEY;


    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error:
          "POLLINATIONS_KEY не настроен в Vercel Environment Variables."
      });
    }


    /*
     * Запрос к Pollinations.
     */
    const response = await fetch(apiUrl, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },

      body: JSON.stringify({
        prompt: finalPrompt,

        model: selectedModel,

        n: 1,

        size: `${imageWidth}x${imageHeight}`,

        quality: selectedQuality,

        response_format: "b64_json"
      })
    });


    /*
     * Получаем ответ.
     */
    const responseText =
      await response.text();


    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        "Pollinations non-JSON response:",
        responseText.slice(0, 1000)
      );

      return res.status(502).json({
        success: false,
        error:
          "Pollinations вернул некорректный ответ."
      });
    }


    /*
     * Ошибка API.
     */
    if (!response.ok) {

      console.error(
        "Pollinations API error:",
        response.status,
        data
      );

      let errorText =
        "Ошибка генерации изображения.";

      if (data?.error) {

        if (typeof data.error === "string") {
          errorText = data.error;
        }

        else if (data.error.message) {
          errorText = data.error.message;
        }

      }

      return res.status(response.status).json({
        success: false,
        error: errorText,
        model: selectedModel
      });
    }


    /*
     * Проверяем структуру ответа.
     */
    const imageData =
      data?.data?.[0];


    if (!imageData) {

      console.error(
        "No image data:",
        data
      );

      return res.status(502).json({
        success: false,
        error:
          "Pollinations не вернул изображение."
      });

    }


    /*
     * Основной вариант:
     * base64
     */
    if (imageData.b64_json) {

      return res.status(200).json({

        success: true,

        model: selectedModel,

        width: imageWidth,

        height: imageHeight,

        quality: selectedQuality,

        image: {
          mime:
            imageData.media_type ||
            "image/png",

          data:
            imageData.b64_json
        }

      });

    }


    /*
     * Некоторые ответы могут вернуть URL.
     *
     * Скачиваем изображение на сервере,
     * превращаем его в base64 и отдаём
     * frontend.
     */
    if (imageData.url) {

      const imageResponse =
        await fetch(imageData.url);


      if (!imageResponse.ok) {

        return res.status(502).json({
          success: false,
          error:
            "Не удалось получить готовое изображение."
        });

      }


      const contentType =
        imageResponse.headers.get(
          "content-type"
        ) || "image/png";


      const arrayBuffer =
        await imageResponse.arrayBuffer();


      const base64 =
        Buffer.from(arrayBuffer)
          .toString("base64");


      return res.status(200).json({

        success: true,

        model: selectedModel,

        width: imageWidth,

        height: imageHeight,

        quality: selectedQuality,

        image: {

          mime: contentType,

          data: base64

        }

      });

    }


    /*
     * Ничего подходящего не пришло.
     */
    console.error(
      "Unknown image response:",
      data
    );


    return res.status(502).json({

      success: false,

      error:
        "API вернул неизвестный формат изображения."

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
