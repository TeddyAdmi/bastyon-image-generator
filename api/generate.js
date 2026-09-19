export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Введите описание изображения"
      });
    }

    const width = Number(body.width) || 1024;
    const height = Number(body.height) || 1024;

    let steps = 20;

    if (body.quality === "low") {
      steps = 15;
    }

    if (body.quality === "high") {
      steps = 30;
    }

    const response = await fetch(
      "https://aihorde.net/api/v2/generate/async",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "apikey": "0000000000",
          "Client-Agent": "bastyon-image-generator:1.0"
        },

        body: JSON.stringify({
          prompt: prompt,

          models: [
            "SDXL 1.0"
          ],

          params: {
            width: width,
            height: height,
            steps: steps,
            cfg_scale: 7,
            sampler_name: "k_euler_a",
            n: 1
          },

          r2: true,

          nsfw: false
        })
      }
    );

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        success: false,
        error: "AI Horde вернул не JSON",
        details: text.slice(0, 500)
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error:
          data.message ||
          data.error ||
          "Ошибка AI Horde",
        details: data
      });
    }

    if (!data.id) {
      return res.status(502).json({
        success: false,
        error: "AI Horde не вернул ID задачи",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      pending: true,
      id: data.id
    });

  } catch (error) {

    console.error("AI HORDE ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Ошибка сервера"
    });
  }
}
