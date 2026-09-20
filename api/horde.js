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
      ratio = "1:1",
      model = "auto"
    } = req.body || {};

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: "Введите описание изображения"
      });
    }

    const dimensions = {
      "1:1": [1024, 1024],
      "16:9": [1024, 576],
      "9:16": [576, 1024],
      "4:3": [1024, 768]
    };

    const [width, height] =
      dimensions[ratio] || dimensions["1:1"];

    const models = {
      "ai-horde-flux": "Flux.1-Schnell fp8 (Compact)",
      "ai-horde-sdxl": "AlbedoBase XL 3.1"
    };

    const payload = {
      prompt: prompt.trim(),
      params: {
        width,
        height,
        steps: 25,
        cfg_scale: 7.5,
        sampler_name: "k_euler_a",
        n: 1
      },
      r2: true,
      nsfw: false,
      shared: false
    };

    if (models[model]) {
      payload.models = [models[model]];
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
        body: JSON.stringify(payload)
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
        status: response.status,
        response: text.slice(0, 1000)
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error:
          data.message ||
          data.error ||
          "AI Horde не принял запрос",
        details: data
      });
    }

    if (!data.id) {
      return res.status(502).json({
        success: false,
        error: "AI Horde не вернул ID задачи",
        response: data
      });
    }

    return res.status(200).json({
      success: true,
      id: data.id,
      kudos: data.kudos || 0,
      provider: "AI Horde",
      model:
        models[model] ||
        "AI Horde Auto",
      ratio
    });
  } catch (error) {
    console.error("Horde submit error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Ошибка AI Horde"
    });
  }
}
