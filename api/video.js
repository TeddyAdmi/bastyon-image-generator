function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseImageData(value) {
  const text = String(value || "").trim();
  const match = text.match(/^data:(image\\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) throw new Error("Изображение должно быть data:image/...;base64,...");

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\\s/g, "");
  const extension =
    mimeType === "image/jpeg" ? "jpg" :
    mimeType === "image/webp" ? "webp" :
    mimeType === "image/gif" ? "gif" : "png";

  return {
    mimeType,
    extension,
    buffer: Buffer.from(base64, "base64")
  };
}

async function toDataUrlFromUrl(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Miya-AI/1.0" }
  });

  if (!response.ok) {
    throw new Error("Не удалось получить исходное изображение: HTTP " + response.status);
  }

  const contentType = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!contentType.startsWith("image/")) {
    throw new Error("Источник вернул не изображение.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length > 8_000_000) {
    throw new Error("Исходное изображение слишком большое.");
  }

  return "data:" + contentType + ";base64," + bytes.toString("base64");
}

async function normalizeImageForLtx(imageBase64, imageUrl) {
  const value = String(imageBase64 || "").trim();

  if (value.startsWith("data:image/")) return value;

  const url = String(imageUrl || "").trim();

  if (isHttpUrl(url)) {
    return toDataUrlFromUrl(url);
  }

  throw new Error("Для LTX не найдено исходное изображение.");
}

function getLtxBaseUrl() {
  return String(process.env.LTX_SERVER_URL || "").replace(/\\/$/, "");
}

async function ltxRequest(path, options = {}) {
  const base = getLtxBaseUrl();

  if (!base) {
    throw new Error("LTX_SERVER_URL не настроен.");
  }

  const response = await fetch(base + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("LTX GPU сервер вернул не JSON (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || "Ошибка LTX GPU сервера.";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }

  return data;
}

function getPixazoKey() {
  return String(
    process.env.PIXAZO_API_KEY ||
    process.env.PIXAZO_SUBSCRIPTION_KEY ||
    ""
  ).trim();
}

const PIXELSTER_VIDEO_URL =
  "https://ahm7xmakki.com/api/ptv";

const PIXAZO_STATUS_URL =
  "https://gateway.pixazo.ai/v2/requests/status/";

async function pixazoRequest(url, options = {}) {
  const key = getPixazoKey();

  if (!key) {
    throw new Error(
      "Не настроен ни LTX GPU, ни PIXAZO_API_KEY. Сначала подключите LTX_SERVER_URL."
    );
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": key,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Pixazo вернул не JSON (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.detail ||
      "Pixazo HTTP " + response.status;

    if (response.status === 401) {
      throw new Error("Pixazo: неверный или отсутствующий API key.");
    }

    if (response.status === 402) {
      throw new Error("Pixazo: недостаточно баланса или бесплатная квота недоступна.");
    }

    if (response.status === 429) {
      throw new Error("Pixazo: превышен лимит запросов.");
    }

    throw new Error(String(message));
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

async function makePublicImageUrl(imageUrl, imageBase64) {
  const directUrl = String(imageUrl || "").trim();
  if (isHttpUrl(directUrl)) return directUrl;

  const source = String(imageBase64 || "").trim();

  if (!source.startsWith("data:image/")) {
    throw new Error("Для Pixazo нужен публичный HTTPS URL исходного изображения.");
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Для Pixazo нужен Vercel Blob, чтобы сделать изображение публичным.");
  }

  const { mimeType, extension, buffer } = parseImageData(source);
  const { put } = await import("@vercel/blob");

  const blob = await put(
    "miya-video-input/" +
      Date.now() + "-" +
      Math.random().toString(36).slice(2) +
      "." + extension,
    buffer,
    {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false
    }
  );

  return blob.url;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    // LTX GPU is the primary video engine.
    if (req.method === "GET") {
      const taskId = String(req.query?.taskId || "").trim();

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error: "Не указан taskId."
        });
      }

      if (taskId.startsWith("ltx:")) {
        const jobId = taskId.slice(4);
        const data = await ltxRequest("/jobs/" + encodeURIComponent(jobId));

        if (data.done && data.success && data.videoUrl) {
          return res.status(200).json({
            success: true,
            done: true,
            status: "SUCCEEDED",
            videoUrl: data.videoUrl,
            provider: "LTX-Video GPU",
            model: data.model || "ltxv-2b-0.9.8-distilled"
          });
        }

        if (data.done && !data.success) {
          return res.status(200).json({
            success: false,
            done: true,
            status: "FAILED",
            error: data.error || "LTX GPU не смог создать видео."
          });
        }

        return res.status(200).json({
          success: true,
          done: false,
          status: data.status || "RUNNING",
          provider: "LTX-Video GPU",
          model: data.model || "ltxv-2b-0.9.8-distilled"
        });
      }

      if (taskId.startsWith("pixazo:")) {
        const requestId = taskId.slice("pixazo:".length);
        const data = await pixazoRequest(
          PIXAZO_STATUS_URL + encodeURIComponent(requestId),
          { method: "GET" }
        );

        const status = String(data?.status || "").toUpperCase();
        const videoUrl =
          data?.output?.media_url?.[0] ||
          data?.output?.mediaUrl?.[0] ||
          "";

        if (status === "COMPLETED") {
          if (!videoUrl) {
            return res.status(502).json({
              success: false,
              done: true,
              error: "Pixazo завершил задачу, но не вернул видео."
            });
          }

          return res.status(200).json({
            success: true,
            done: true,
            status,
            videoUrl,
            provider: "Pixazo",
            model: "LTX 2.5"
          });
        }

        if (status === "FAILED" || status === "ERROR") {
          return res.status(200).json({
            success: false,
            done: true,
            status,
            error: data?.error || data?.message || "Pixazo не смог создать видео."
          });
        }

        return res.status(200).json({
          success: true,
          done: false,
          status: status || "QUEUED",
          provider: "Pixazo",
          model: "LTX 2.5"
        });
      }

      return res.status(400).json({
        success: false,
        error: "Неизвестный формат taskId."
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
    const imageUrl = String(body.imageUrl || "").trim();
    const imageBase64 = String(body.imageBase64 || "").trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Введите описание движения для видео."
      });
    }

    if (!imageUrl && !imageBase64) {
      return res.status(400).json({
        success: false,
        error: "Изображение не загружено."
      });
    }

    // LTX path: no /api/edit and no paid image preparation.
    if (getLtxBaseUrl()) {
      const normalizedImage = await normalizeImageForLtx(
        imageBase64,
        imageUrl
      );

      const ltxData = await ltxRequest("/generate", {
        method: "POST",
        body: JSON.stringify({
          imageBase64: normalizedImage,
          prompt
        })
      });

      if (!ltxData?.jobId) {
        throw new Error("LTX GPU сервер не вернул jobId.");
      }

      return res.status(202).json({
        success: true,
        done: false,
        taskId: "ltx:" + ltxData.jobId,
        status: ltxData.status || "queued",
        provider: "LTX-Video GPU",
        model: ltxData.model || "ltxv-2b-0.9.8-distilled",
        duration: ltxData.duration || 5
      });
    }

    // Free fallback: PixelSter image-to-video.
    // This is used when the dedicated LTX GPU is not configured.
    const pixelImageBase64 = imageBase64 || (
      imageUrl ? await toDataUrlFromUrl(imageUrl) : ""
    );

    const pixelResponse = await fetch(PIXELSTER_VIDEO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        prompt,
        ratio: body.aspect || "16:9",
        duration: Math.min(20, Math.max(5, Number(body.duration) || 6)),
        imageBase64: pixelImageBase64
      })
    });

    const pixelText = await pixelResponse.text();
    let pixelData = {};
    try {
      pixelData = pixelText ? JSON.parse(pixelText) : {};
    } catch {
      throw new Error(
        "PixelSter видео вернул не JSON (HTTP " +
          pixelResponse.status +
          ")."
      );
    }

    if (!pixelResponse.ok || !pixelData.videoUrl) {
      throw new Error(
        pixelData.error ||
          pixelData.message ||
          "PixelSter не смог создать видео (HTTP " +
          pixelResponse.status +
          ")."
      );
    }

    return res.status(200).json({
      success: true,
      done: true,
      status: "SUCCEEDED",
      videoUrl: pixelData.videoUrl,
      provider: "PixelSter",
      model: "Motion Synthesis",
      duration: Number(body.duration) || 6
    });
  } catch (error) {
    console.error("Video API error:", error);

    const message = String(
      error?.message ||
      error?.error ||
      error ||
      "Ошибка видеогенерации."
    );

    const setupMissing =
      message.includes("LTX_SERVER_URL") ||
      message.includes("PIXAZO_API_KEY");

    return res.status(setupMissing ? 503 : 500).json({
      success: false,
      error: setupMissing
        ? "Видеодвижок не подключён. Для Miya нужно задать LTX_SERVER_URL в Vercel и запустить gpu-server в Cloud Studio."
        : message
    });
  }
}
