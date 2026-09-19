```javascript
// api/generate.js
// Bastyon AI Image Generator
// AI Horde — полностью бесплатная генерация
//
// Этот endpoint ТОЛЬКО создаёт задание.
// Результат забирается через /api/status?id=...

export default async function handler(req, res) {
  // --------------------------------------------------
  // CORS
  // --------------------------------------------------

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  // --------------------------------------------------
  // OPTIONS
  // --------------------------------------------------

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // --------------------------------------------------
  // METHOD
  // --------------------------------------------------

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    // ------------------------------------------------
    // BODY
    // ------------------------------------------------

    const body = req.body || {};

    const prompt = String(
      body.prompt || ""
    ).trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Промпт пустой"
      });
    }

    // ------------------------------------------------
    // AI HORDE
    // ------------------------------------------------

    const HORDE_API =
      "https://aihorde.net/api/v2";

    /*
      AI Horde официально разрешает
      анонимный API key:

      0000000000

      Для приложения лучше потом получить
      собственный бесплатный ключ.
    */

    const apiKey =
      process.env.AI_HORDE_API_KEY ||
      "0000000000";

    // ------------------------------------------------
    // FRONTEND PARAMETERS
    // ------------------------------------------------

    let requestedWidth =
      Number(body.width) || 1024;

    let requestedHeight =
      Number(body.height) || 1024;

    const quality =
      String(
        body.quality || "medium"
      ).toLowerCase();

    // ------------------------------------------------
    // ASPECT RATIO
    // ------------------------------------------------

    function getAspectRatio(
      width,
      height
    ) {
      const ratio =
        width / height;

      const ratios = [
        {
          name: "1:1",
          value: 1
        },
        {
          name: "16:9",
          value: 16 / 9
        },
        {
          name: "9:16",
          value: 9 / 16
        },
        {
          name: "4:3",
          value: 4 / 3
        },
        {
          name: "3:4",
          value: 3 / 4
        },
        {
          name: "4:5",
          value: 4 / 5
        },
        {
          name: "5:4",
          value: 5 / 4
        }
      ];

      let closest =
        ratios[0];

      let difference =
        Math.abs(
          ratio -
          closest.value
        );

      for (
        const item of ratios
      ) {
        const currentDifference =
          Math.abs(
            ratio -
            item.value
          );

        if (
          currentDifference <
          difference
        ) {
          closest =
            item;

          difference =
            currentDifference;
        }
      }

      return closest.name;
    }

    const aspectRatio =
      getAspectRatio(
        requestedWidth,
        requestedHeight
      );

    // ------------------------------------------------
    // DIMENSIONS
    // ------------------------------------------------

    /*
      Для SDXL используем проверенные размеры.

      Это важнее, чем просто отправлять
      любые 768 / 1024 / 1280 / 1536,
      потому что AI Horde работает
      с разными workers.
    */

    const dimensions = {
      "1:1": {
        width: 1024,
        height: 1024
      },

      "16:9": {
        width: 1216,
        height: 704
      },

      "9:16": {
        width: 704,
        height: 1216
      },

      "4:3": {
        width: 1152,
        height: 896
      },

      "3:4": {
        width: 896,
        height: 1152
      },

      "4:5": {
        width: 896,
        height: 1120
      },

      "5:4": {
        width: 1120,
        height: 896
      }
    };

    const selectedDimensions =
      dimensions[aspectRatio] ||
      dimensions["1:1"];

    const width =
      selectedDimensions.width;

    const height =
      selectedDimensions.height;

    // ------------------------------------------------
    // QUALITY → STEPS
    // ------------------------------------------------

    let steps = 25;

    if (
      quality === "low"
    ) {
      steps = 15;
    }

    if (
      quality === "medium"
    ) {
      steps = 25;
    }

    if (
      quality === "high"
    ) {
      steps = 35;
    }

    // ------------------------------------------------
    // MODEL
    // ------------------------------------------------

    /*
      Не привязываемся к старым моделям
      из твоего Gemini/Pollinations интерфейса.

      SDXL 1.0 — основной вариант.
    */

    const model =
      "SDXL 1.0";

    // ------------------------------------------------
    // HORDE REQUEST
    // ------------------------------------------------

    const requestBody = {
      prompt: prompt,

      params: {
        width: width,

        height: height,

        steps: steps,

        cfg_scale: 7,

        sampler_name:
          "k_euler_a",

        n: 1,

        /*
          Не просим дополнительные
          post-processing операции.
        */

        post_processing: []
      },

      models: [
        model
      ],

      /*
        Разрешаем R2 storage,
        чтобы Horde мог вернуть URL
        готового изображения.
      */

      r2: true,

      /*
        Без NSFW.
      */

      nsfw: false
    };

    console.log(
      "--------------------------------"
    );

    console.log(
      "AI HORDE REQUEST"
    );

    console.log(
      "Model:",
      model
    );

    console.log(
      "Prompt:",
      prompt
    );

    console.log(
      "Aspect:",
      aspectRatio
    );

    console.log(
      "Width:",
      width
    );

    console.log(
      "Height:",
      height
    );

    console.log(
      "Quality:",
      quality
    );

    console.log(
      "Steps:",
      steps
    );

    console.log(
      "--------------------------------"
    );

    // ------------------------------------------------
    // SEND JOB
    // ------------------------------------------------

    const response =
      await fetch(
        `${HORDE_API}/generate/async`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            apikey:
              apiKey,

            "Client-Agent":
              "Bastyon-AI-Image-Generator:1.0"
          },

          body:
            JSON.stringify(
              requestBody
            )
        }
      );

    // ------------------------------------------------
    // READ RESPONSE
    // ------------------------------------------------

    const text =
      await response.text();

    console.log(
      "AI Horde HTTP:",
      response.status
    );

    console.log(
      "AI Horde RESPONSE:",
      text.substring(
        0,
        3000
      )
    );

    // ------------------------------------------------
    // JSON
    // ------------------------------------------------

    let data;

    try {
      data =
        JSON.parse(text);
    } catch (error) {
      return res.status(502).json({
        success: false,

        error:
          "AI Horde вернул не JSON",

        status:
          response.status,

        response:
          text.substring(
            0,
            2000
          )
      });
    }

    // ------------------------------------------------
    // HORDE ERROR
    // ------------------------------------------------

    if (
      !response.ok
    ) {
      return res.status(
        response.status
      ).json({
        success: false,

        error:
          data?.message ||
          data?.error ||
          "AI Horde отклонил запрос",

        details:
          data
      });
    }

    // ------------------------------------------------
    // GENERATION ID
    // ------------------------------------------------

    const generationId =
      data?.id;

    if (
      !generationId
    ) {
      return res.status(502).json({
        success: false,

        error:
          "AI Horde не вернул ID задания",

        response:
          data
      });
    }

    console.log(
      "AI HORDE JOB ID:",
      generationId
    );

    // ------------------------------------------------
    // IMPORTANT
    // ------------------------------------------------

    /*
      НИЧЕГО БОЛЬШЕ НЕ ЖДЁМ.

      Не делаем здесь polling.

      Vercel сразу отдаёт браузеру JSON.
    */

    return res.status(200).json({
      success: true,

      pending: true,

      id:
        generationId,

      model:
        model,

      width:
        width,

      height:
        height,

      aspectRatio:
        aspectRatio,

      quality:
        quality,

      steps:
        steps,

      message:
        "Изображение поставлено в очередь AI Horde"
    });

  } catch (error) {
    console.error(
      "AI HORDE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error?.message ||
        "Внутренняя ошибка сервера"

```
