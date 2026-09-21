function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseImageData(imageBase64) {
  const value = String(imageBase64 || "").trim();
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);

  if (!match) {
    throw new Error("Изображение должно быть data:image/...;base64,...");
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");

  const extensionMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
  };

  return {
    mimeType,
    extension: extensionMap[mimeType] || "png",
    buffer: Buffer.from(base64, "base64")
  };
}

function getPixazoKey() {
  return String(
    process.env.PIXAZO_API_KEY ||
    process.env.PIXAZO_SUBSCRIPTION_KEY ||
    ""
  ).trim();
}

const PIXAZO_CREATE_URL =
  "https://gateway.pixazo.ai/ltx-video/v1/image-to-video";

const PIXAZO_STATUS_URL =
  "https://gateway.pixazo.ai/v2/requests/status/";

async function pixazoRequest(url, options = {}) {
  const key = getPixazoKey();

  if (!key) {
    throw new Error(
      "PIXAZO_API_KEY не настроен в Vercel. Добавьте Primary API key Pixazo."
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

  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      "Pixazo вернул не JSON. HTTP " +
      response.status +
      ". Ответ: " +
      text.slice(0, 300)
    );
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.detail ||
      ("Pixazo HTTP " + response.status);

    if (response.status === 401) {
      throw new Error("Pixazo: неверный или отсутствующий API key.");
    }

    if (response.status === 402) {
      throw new Error(
        "Pixazo: недостаточно баланса. Проверьте, что используется бесплатный LTX 2.5 endpoint."
      );
    }

    if (response.status === 429) {
      throw new Error("Pixazo: превышен лимит запросов. Попробуйте позже.");
    }

    throw new Error(String(message));
  }

  return data;
}

function getBody(req) {
  if (!req || req.body == null) return {};

  if (typeof req.body === "object") {
    return req.body;
  }

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

  // Pixazo requires a publicly reachable HTTP(S) image URL.
  if (isHttpUrl(directUrl)) {
    return directUrl;
  }

  const source = String(imageBase64 || "").trim();

  if (isHttpUrl(source)) {
    return source;
  }

  // A browser blob: URL is not reachable by Pixazo.
  if (source.startsWith("blob:")) {
    throw new Error(
      "Изображение имеет локальный blob: URL. Для видео нужен публичный HTTPS URL. Нажмите «Создать видео» после генерации/редактирования изображения или подключите Vercel Blob."
    );
  }

  if (!source.startsWith("data:image/")) {
    throw new Error(
      "Pixazo требует публичный HTTPS URL исходного изображения."
    );
  }

  // If Blob is configured, convert the data URL to a public HTTPS URL.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { mimeType, extension, buffer } = parseImageData(source);

    if (!buffer.length) {
      throw new Error("Не удалось прочитать исходное изображение.");
    }

    const { put } = await import("@vercel/blob");

    const blob = await put(
      "miya-video-input/" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2) +
        "." +
        extension,
      buffer,
      {
        access: "public",
        contentType: mimeType,
        addRandomSuffix: false
      }
    );

    return blob.url;
  }

  throw new Error(
    "Для видео это изображение пока недоступно по публичному HTTPS URL. Vercel Blob не настроен. Используйте изображение, которое уже имеет HTTPS URL, либо подключите BLOB_READ_WRITE_TOKEN."
  );
}

export default async function handler(req, res) {
  // Always return JSON, including errors, so the browser never receives
  // an HTML error page from this function.
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

      const requestId = taskId.startsWith("pixazo:")
        ? taskId.slice("pixazo:".length)
        : taskId;

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
            error: "Pixazo завершил задачу, но не вернул ссылку на видео."
          });
        }

        return res.status(200).json({
          success: true,
          done: true,
          status,
          videoUrl,
          provider: "Pixazo",
          model: "LTX 2.5 Free",
          mediaType: data?.output?.media_type || "video/mp4"
        });
      }

      if (status === "FAILED" || status === "ERROR") {
        return res.status(200).json({
          success: false,
          done: true,
          status,
          error:
            data?.error ||
            data?.message ||
            "Pixazo не смог создать видео."
        });
      }

      return res.status(200).json({
        success: true,
        done: false,
        status: status || "QUEUED",
        provider: "Pixazo",
        model: "LTX 2.5 Free"
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

    if (imageBase64.length > 4_000_000) {
      return res.status(413).json({
        success: false,
        error:
          "Изображение слишком большое для передачи в Vercel API. Используйте изображение с публичным HTTPS URL."
      });
    }

    const publicImageUrl = await makePublicImageUrl(
      imageUrl,
      imageBase64
    );

    const data = await pixazoRequest(
      PIXAZO_CREATE_URL,
      {
        method: "POST",
        body: JSON.stringify({
          prompt,
          image_url: publicImageUrl,
          strength: 1.0,
          aspect: body.aspect || "9:16",
          num_frames: 121,
          frame_rate: 24,
          steps: 8,
          cfg: 3.0
        })
      }
    );

    if (!data?.request_id) {
      return res.status(502).json({
        success: false,
        error: "Pixazo не вернул request_id."
      });
    }

    return res.status(202).json({
      success: true,
      done: false,
      taskId: "pixazo:" + data.request_id,
      requestId: data.request_id,
      status: data.status || "QUEUED",
      provider: "Pixazo",
      model: "LTX 2.5 Free",
      pollingUrl: data.polling_url || ""
    });
  } catch (error) {
    console.error("Pixazo video API error:", error);

    return res.status(500).json({
      success: false,
      error:
        error?.message ||
        "Ошибка видеогенерации через Pixazo.",
      provider: "Pixazo",
      model: "LTX 2.5 Free"
    });
  }
}
