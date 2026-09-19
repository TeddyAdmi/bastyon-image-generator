export default async function handler(req, res) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {

    const id =
      req.query?.id;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Не указан ID задачи"
      });
    }

    const response = await fetch(
      `https://aihorde.net/api/v2/generate/status/${encodeURIComponent(id)}`,
      {
        method: "GET",

        headers: {
          "apikey": "0000000000",
          "Client-Agent":
            "bastyon-image-generator:1.0"
        }
      }
    );

    const text =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(text);
    }

    catch {
      return res.status(502).json({
        success: false,

        error:
          "AI Horde вернул не JSON",

        details:
          text.slice(0, 500)
      });
    }

    if (!response.ok) {
      return res.status(
        response.status
      ).json({
        success: false,

        error:
          data.message ||
          data.error ||
          "Ошибка статуса AI Horde",

        details: data
      });
    }

    if (
      data.done === true &&
      data.generations &&
      data.generations.length > 0
    ) {

      const generation =
        data.generations[0];

      return res.status(200).json({

        success: true,

        done: true,

        image:
          generation.img || null,

        seed:
          generation.seed || null
      });
    }

    return res.status(200).json({

      success: true,

      done: false,

      finished:
        data.finished || 0,

      processing:
        data.processing || 0,

      queue_position:
        data.queue_position || 0,

      wait_time:
        data.wait_time || 0
    });

  }

  catch (error) {

    console.error(
      "STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        error.message ||
        "Ошибка проверки статуса"
    });
  }
}
