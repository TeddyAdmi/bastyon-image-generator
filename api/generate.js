// api/generate.js
// Gemini 3.1 Flash Image
// Bastyon AI Image Generator

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        success: false,
        error: "GEMINI_API_KEY не настроен в Vercel"
      });
    }

    const body = req.body || {};

    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Промпт пустой"
      });
    }

    // ---------------------------------------------------------
    // MODEL
    // ---------------------------------------------------------

    // Любое имя модели от старого интерфейса
    // сейчас направляем на Gemini 3.1 Flash Image.
    const model = "gemini-3.1-flash-image";

    // ---------------------------------------------------------
    // ASPECT RATIO
    // ---------------------------------------------------------

    const requestedWidth = Number(body.width) || 1024;
    const requestedHeight = Number(body.height) || 1024;

    function getAspectRatio(width, height) {
      const ratio = width / height;

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

      let closest = ratios[0];
      let difference = Math.abs(ratio - closest.ratio);

      for (const item of ratios) {
        const currentDifference = Math.abs(ratio - item.ratio);

        if (currentDifference < difference) {
          closest = item;
          difference = currentDifference;
        }
      }

      return closest.value;
    }

    const aspectRatio = getAspectRatio(
      requestedWidth,
      requestedHeight
    );

    // ---------------------------------------------------------
    // QUALITY
    // ---------------------------------------------------------

    const quality = String(body.quality || "medium").toLowerCase();

    let imageSize = "1K";

    if (quality === "low") {
      imageSize = "512";
    } else if (quality === "high") {
      imageSize = "2K";
    } else {
      imageSize = "1K";
    }

    // ---------------------------------------------------------
    // GEMINI REQUEST
    // ---------------------------------------------------------

    const url =
      "https://generativelanguage.googleapis.com/v1beta/interactions";

    const requestBody = {
      model,
      input: prompt,
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: aspectRatio,
        image_size: imageSize
      }
    };

    console.log("Gemini request:", {
      model,
      aspectRatio,
      imageSize,
      prompt
    });

    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },

      body: JSON.stringify(requestBody)
    });

    // ---------------------------------------------------------
    // READ RESPONSE SAFELY
    // ---------------------------------------------------------

    const responseText = await response.text();

    console.log(
      "Gemini HTTP status:",
      response.status
    );

    console.log(
      "Gemini raw response:",
      responseText.substring(0, 3000)
    );

    let data;

    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      return res.status(502).json({
        success: false,
        error: "Gemini вернул не JSON",
        status: response.status,
        response: responseText.substring(0, 2000)
      });
    }

    // ---------------------------------------------------------
    // GEMINI ERROR
    // ---------------------------------------------------------

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        "Ошибка Gemini API";

      return res.status(response.status).json({
        success: false,
        error: message,
        details: data
      });
    }

    // ---------------------------------------------------------
    // FIND IMAGE
    // ---------------------------------------------------------

    let imageData = null;
    let mimeType = "image/png";

    // Новый Interactions API
    if (
      data &&
      data.output_image &&
      data.output_image.data
    ) {
      imageData = data.output_image.data;

      mimeType =
        data.output_image.mime_type ||
        data.output_image.mimeType ||
        "image/png";
    }

    // Дополнительный вариант структуры
    if (!imageData && Array.isArray(data.steps)) {
      for (const step of data.steps) {
        if (!Array.isArray(step.content)) {
          continue;
        }

        for (const content of step.content) {
          if (
            content &&
            content.type === "image" &&
            content.data
          ) {
            imageData = content.data;

            mimeType =
              content.mime_type ||
              content.mimeType ||
              "image/png";

            break;
          }
        }

        if (imageData) {
          break;
        }
      }
    }

    // ---------------------------------------------------------
    // NO IMAGE
    // ---------------------------------------------------------

    if (!imageData) {
      return res.status(502).json({
        success: false,
        error: "Gemini не вернул изображение",
        response: data
      });
    }

    // ---------------------------------------------------------
    // SUCCESS
    // ---------------------------------------------------------

    return res.status(200).json({
      success: true,

      model,

      width: requestedWidth,
      height: requestedHeight,

      aspectRatio,

      imageSize,

      quality,

      image: {
        mime: mimeType,
        data: imageData
      }
    });

  } catch (error) {
    console.error(
      "Gemini generation error:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Внутренняя ошибка сервера"
    });
  }
}
