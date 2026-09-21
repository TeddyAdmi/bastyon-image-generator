function getPixazoKey() {
  return String(
    process.env.PIXAZO_API_KEY ||
    process.env.PIXAZO_SUBSCRIPTION_KEY ||
    ""
  ).trim();
}

const CREATE_URL = "https://gateway.pixazo.ai/tracks/v1/generate";
const STATUS_URL = "https://gateway.pixazo.ai/v2/requests/status/";

async function pixazo(url, options = {}) {
  const key = getPixazoKey();

  if (!key) {
    throw new Error("PIXAZO_API_KEY не настроен в Vercel.");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Ocp-Apim-Subscription-Key": key,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      "Pixazo Audio вернул не JSON. HTTP " +
      response.status +
      ". " +
      text.slice(0, 300)
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.detail ||
      ("Pixazo Audio HTTP " + response.status)
    );
  }

  return data;
}

function getBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new Error("Сервер получил некорректный JSON.");
    }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const taskId = String(req.query?.taskId || "").trim();

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error: "Не указан taskId."
        });
      }

      const requestId = taskId.startsWith("pixazo-audio:")
        ? taskId.slice("pixazo-audio:".length)
        : taskId;

      const data = await pixazo(
        STATUS_URL + encodeURIComponent(requestId),
        { method: "GET" }
      );

      const status = String(data?.status || "").toUpperCase();
      const audioUrl =
        data?.output?.media_url?.[0] ||
        data?.output?.mediaUrl?.[0] ||
        "";

      if (status === "COMPLETED") {
        if (!audioUrl) {
          return res.status(502).json({
            success: false,
            done: true,
            error: "Pixazo Audio завершил задачу, но не вернул аудио."
          });
        }

        return res.status(200).json({
          success: true,
          done: true,
          status,
          audioUrl,
          provider: "Pixazo Tracks"
        });
      }

      if (
        status === "FAILED" ||
        status === "ERROR"
      ) {
        return res.status(200).json({
          success: false,
          done: true,
          status,
          error:
            data?.error ||
            data?.message ||
            "Pixazo Tracks не смог создать аудио."
        });
      }

      return res.status(200).json({
        success: true,
        done: false,
        status: status || "QUEUED",
        provider: "Pixazo Tracks"
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const body = getBody(req);
    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Не указан prompt для аудио."
      });
    }

    const data = await pixazo(
      CREATE_URL,
      {
        method: "POST",
        body: JSON.stringify({
          prompt,
          lyrics: "",
          duration: Math.min(
            20,
            Math.max(6, Number(body.duration) || 6)
          ),
          bpm: 100,
          time_signature: "4/4"
        })
      }
    );

    if (!data?.request_id) {
      return res.status(502).json({
        success: false,
        error: "Pixazo Tracks не вернул request_id."
      });
    }

    return res.status(202).json({
      success: true,
      done: false,
      taskId: "pixazo-audio:" + data.request_id,
      requestId: data.request_id,
      status: data.status || "QUEUED",
      provider: "Pixazo Tracks"
    });
  } catch (error) {
    console.error("Pixazo audio API error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Ошибка генерации аудио через Pixazo Tracks.",
      provider: "Pixazo Tracks"
    });
  }
}
