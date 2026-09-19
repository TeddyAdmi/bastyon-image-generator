```javascript
// api/generate.js
// Bastyon AI Image Generator
// Бесплатная генерация через AI Horde
//
// Не нужны:
// GEMINI_API_KEY
// POLLINATIONS_KEY
//
// AI Horde anonymous API key:
// 0000000000

export default async function handler(req, res) {
  // --------------------------------------------------
  // CORS
  // --------------------------------------------------

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

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
    // ------------------------------------------------
    // INPUT
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

    const HORDE_URL =
      "https://aihorde.net/api/v2";

    // Полностью бесплатный анонимный ключ
    const API_KEY =
      process.env.AI_HORDE_API_KEY ||
      "0000000000";

    // ------------------------------------------------
    // FRONTEND SIZE
    // ------------------------------------------------

    let width =
      Number(body.width) || 1024;

    let height =
      Number(body.height) || 1024;

    // ------------------------------------------------
    // LIMIT EXTREME SIZES
    // ------------------------------------------------

    // Для бесплатной очереди не отправляем
    // огромные изображения.

    width = Math.max(
      512,
      Math.min(width, 1536)
    );

    height = Math.max(
      512,
      Math.min(height, 1536)
    );

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
        const current =
          Math.abs(
            ratio -
            item.value
          );

        if (
          current <
          difference
        ) {
          closest =
            item;

          difference =
            current;
        }
      }

      return closest.name;
    }

    const aspectRatio =
      getAspectRatio(
        width,
        height
      );

    // ------------------------------------------------
    // QUALITY
    // ------------------------------------------------

    const quality =
      String(
        body.quality ||
        "medium"
      ).toLowerCase();

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

    // SDXL — хороший универсальный вариант
    // для бесплатной генерации через Horde.

    const model =
      "SDXL 1.0";

    // ------------------------------------------------
    // DIMENSIONS
    // ------------------------------------------------

    /*
      AI Horde / SDXL лучше работает,
      когда размеры соответствуют выбранной
      пропорции.
    */

    const dimensions =
      getDimensionsForRatio(
        aspectRatio,
        width,
        height
      );

    width =
      dimensions.width;

    height =
      dimensions.height;

    // ------------------------------------------------
    // REQUEST
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

        post_processing: []
      },

      models: [
        model
      ],

      r2: true,

      nsfw: false
    };

    console.log(
      "================================="
    );

    console.log(
      "AI HORDE GENERATION"
    );

    console.log(
      "model:",
      model
    );

    console.log(
      "aspect:",
      aspectRatio
    );

    console.log(
      "width:",
      width
    );

    console.log(
      "height:",
      height
    );

    console.log(
      "quality:",
      quality
    );

    console.log(
      "steps:",
      steps
    );

    console.log(
      "prompt:",
      prompt
    );

    console.log(
      "================================="
    );

    // ------------------------------------------------
    // START GENERATION
    // ------------------------------------------------

    const generationResponse =
      await fetch(
        `${HORDE_URL}/generate/async`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            apikey:
              API_KEY,

            Client-Agent:
              "Bastyon-AI-Image-Generator:1.0"
          },

          body:
            JSON.stringify(
              requestBody
            )
        }
      );

    const generationText =
      await generationResponse.text();

    console.log(
      "AI Horde submit status:",
      generationResponse.status
    );

    console.log(
      "AI Horde submit response:",
      generationText.substring(
        0,
        3000
      )
    );

    let generationData;

    try {
      generationData =
        JSON.parse(
          generationText
        );
    } catch (error) {
      return res.status(502).json({
        success: false,

        error:
          "AI Horde вернул не JSON",

        response:
          generationText.substring(
            0,
            2000
          )
      });
    }

    // ------------------------------------------------
    // SUBMIT ERROR
    // ------------------------------------------------

    if (
      !generationResponse.ok
    ) {
      return res.status(
        generationResponse.status
      ).json({
        success: false,

        error:
          generationData?.message ||
          generationData?.error ||
          "AI Horde не принял запрос",

        details:
          generationData
      });
    }

    const generationId =
      generationData.id;

    if (!generationId) {
      return res.status(502).json({
        success: false,

        error:
          "AI Horde не вернул ID генерации",

        response:
          generationData
      });
    }

    console.log(
      "Generation ID:",
      generationId
    );

    // ------------------------------------------------
    // WAIT FOR RESULT
    // ------------------------------------------------

    const MAX_WAIT =
      240000;

    const POLL_INTERVAL =
      2500;

    const startTime =
      Date.now();

    let lastStatus =
      null;

    while (
      Date.now() -
        startTime <
      MAX_WAIT
    ) {
      await sleep(
        POLL_INTERVAL
      );

      const statusResponse =
        await fetch(
          `${HORDE_URL}/generate/status/${generationId}`,
          {
            method: "GET",

            headers: {
              apikey:
                API_KEY,

              "Client-Agent":
                "Bastyon-AI-Image-Generator:1.0"
            }
          }
        );

      const statusText =
        await statusResponse.text();

      let statusData;

      try {
        statusData =
          JSON.parse(
            statusText
          );
      } catch (error) {
        console.error(
          "Invalid Horde status JSON:",
          statusText.substring(
            0,
            2000
          )
        );

        continue;
      }

      lastStatus =
        statusData;

      console.log(
        "Horde status:",
        JSON.stringify(
          {
            done:
              statusData.done,

            processing:
              statusData.processing,

            queue_position:
              statusData.queue_position,

            finished:
              statusData.finished
          }
        )
      );

      // ------------------------------------------------
      // DONE
      // ------------------------------------------------

      if (
        statusData.done === true
      ) {
        // ----------------------------------------------
        // CHECK GENERATIONS
        // ----------------------------------------------

        if (
          !Array.isArray(
            statusData.generations
          ) ||
          statusData.generations.length === 0
        ) {
          return res.status(502).json({
            success: false,

            error:
              "AI Horde завершил генерацию, но изображение отсутствует",

            response:
              statusData
          });
        }

        const result =
          statusData
            .generations[0];

        // ----------------------------------------------
        // IMAGE URL
        // -------------------------------------------
```
