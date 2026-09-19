// api/generate.js
// Bastyon AI Image Generator
// Gemini 3.1 Flash Image

export default async function handler(req, res) {
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

    // --------------------------------------------------
    // MODEL
    // --------------------------------------------------

    const model = "gemini-3.1-flash-image";

    // --------------------------------------------------
    // SIZE
    // --------------------------------------------------

    const width = Number(body.width) || 1024;
    const height = Number(body.height) || 1024;

    // --------------------------------------------------
    // ASPECT RATIO
    // --------------------------------------------------

    function getAspectRatio(width, height) {
      const ratio = width / height;

      const available = [
        { name: "1:1", value: 1 },
        { name: "16:9", value: 16 / 9 },
        { name: "9:16", value: 9 / 16 },
        { name: "4:3", value: 4 / 3 },
        { name: "3:4", value: 3 / 4 },
        { name: "4:5", value: 4 / 5 },
        { name: "5:4", value: 5 / 4 },
        { name: "3:2", value: 3 / 2 },
        { name: "2:3", value: 2 / 3 },
        { name: "21:9", value: 21 / 9 }
      ];

      let closest = available[0];
      let difference = Math.abs(ratio - closest.value);

      for (const item of available) {
        const currentDifference = Math.abs(
          ratio - item.value
        );

        if (currentDifference < difference) {
          closest = item;
          difference = currentDifference;
        }
      }

      return closest.name;
    }

    const aspectRatio = getAspectRatio(width, height);

    // --------------------------------------------------
    // QUALITY
    // --------------------------------------------------

    const quality = String(
      body.quality || "medium"
    ).toLowerCase();

    let imageSize = "1K";

    if (quality === "low") {
      imageSize = "512px";
    }

    if (quality === "medium") {
      imageSize = "1K";
    }

    if (quality === "high") {
      imageSize = "2K";
    }

    // --------------------------------------------------
    // GEMINI INTERACTIONS API
    // --------------------------------------------------

    const url =
      "https://generativelanguage.googleapis.com/v1beta/interactions";

    const requestBody = {
      model: model,

      input: prompt,

      response_format: {
        type: "image",

        // Gemini currently expects JPEG here
        mime_type: "image/jpeg",

        aspect_ratio: aspectRatio,

        image_size: imageSize
      }
    };

    console.log("=================================");
    console.log("GEMINI REQUEST");
    console.log("model:", model);
    console.log("aspectRatio:", aspectRatio);
    console.log("imageSize:", imageSize);
    console.log("quality:", quality);
    console.log("width:", width);
    console.log("height:", height);
    console.log("prompt:", prompt);
    console.log("=================================");

    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },

      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();

    console.log(
      "Gemini HTTP status:",
      response.status
    );

    console.log(
      "Gemini response:",
      responseText.substring(0, 5000)
    );

    // --------------------------------------------------
    // JSON
    // --------------------------------------------------

    let data;

    try {
      data = JSON.parse(responseText);
    } catch (error) {
      return res.status(502).json({
        success: false,
        error: "Gemini вернул не JSON",
        status: response.status,
        response: responseText.substring(0, 2000)
      });
    }

    // --------------------------------------------------
    // API ERROR
    // --------------------------------------------------

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

    // --------------------------------------------------
    // IMAGE
    // --------------------------------------------------

    let imageData = null;
    let mimeType = "image/jpeg";

    // Основной формат Interactions API
    if (
      data?.output_image?.data
    ) {
      imageData =
        data.output_image.data;

      mimeType =
        data.output_image.mime_type ||
        data.output_image.mimeType ||
        "image/jpeg";
    }

    // --------------------------------------------------
    // FALLBACK: steps
    // --------------------------------------------------

    if (
      !imageData &&
      Array.isArray(data?.steps)
    ) {
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
              "image/jpeg";

            break;
          }
        }

        if (imageData) {
          break;
        }
      }
    }

    // --------------------------------------------------
    // NO IMAGE
    // --------------------------------------------------

    if (!imageData) {
      console.error(
        "Gemini не вернул изображение:",
        JSON.stringify(data).substring(0, 5000)
      );

      return res.status(502).json({
        success: false,
        error: "Gemini не вернул изображение",
        response: data
      });
    }

    // --------------------------------------------------
    // SUCCESS
    // --------------------------------------------------

    console.log("IMAGE RECEIVED");
    console.log("mime:", mimeType);
    console.log(
      "base64 length:",
      imageData.length
    );

    return res.status(200).json({
      success: true,

      model: model,

      width: width,

      height: height,

      aspectRatio: aspectRatio,

      imageSize: imageSize,

      quality: quality,

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
