function parseImageData(imageBase64) {
  const value = String(imageBase64 || "");
  const match = value.match(/^data:(image\\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);

  if (!match) {
    throw new Error("Изображение должно быть передано в формате data:image/...;base64,...");
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\\s/g, "");

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

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getAlibabaBaseUrl() {
  // The legacy DashScope domain remains supported for Wan 2.2.
  // The API key must belong to the China (Beijing) region.
  return "https://dashscope.aliyuncs.com";
}

async function uploadImageIfNeeded(source) {
  if (!source.startsWith("data:image/")) {
    if (!isHttpUrl(source)) {
      throw new Error("Изображение должно быть URL или data:image/...;base64,...");
    }
    return source;
  }

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

function normalizeAlibabaError(data, fallback) {
  const message =
    data?.message ||
    data?.output?.message ||
    data?.output?.code ||
    fallback;

  if (/quota|rate.?limit|throttl/i.test(String(message))) {
    return "Alibaba Cloud: превышен лимит запросов или бесплатная квота.";
  }

  if (/invalid.*api.?key|api.?key.*invalid|unauthorized/i.test(String(message))) {
    return "Alibaba Cloud: неверный API-ключ. Проверьте DASHSCOPE_API_KEY и регион China (Beijing).";
  }

  if (/insufficient|balance|billing|payment|fund/i.test(String(message))) {
    return "Alibaba Cloud: бесплатная квота исчерпана или для аккаунта требуется биллинг.";
  }

  return String(message);
}

async function getTask(taskId) {
  const response = await fetch(
    getAlibabaBaseUrl() + "/api/v1/tasks/" + encodeURIComponent(taskId),
    {
      method: "GET",
      headers: {
        Authorization: "Bearer " + process.env.DASHSCOPE_API_KEY
      }
    }
  );

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Alibaba Cloud вернул не JSON при проверке задачи.");
  }

  if (!response.ok) {
    throw new Error(normalizeAlibabaError(data, "Ошибка проверки задачи Alibaba Cloud."));
  }

  return data;
}

export default async function handler(req, res) {
  if (!process.env.DASHSCOPE_API_KEY) {
    return res.status(503).json({
      success: false,
      error: "Alibaba Cloud ещё не настроен. Добавьте DASHSCOPE_API_KEY в Vercel."
    });
  }

  try {
    // GET /api/video?taskId=... — poll Alibaba task status.
    if (req.method === "GET") {
      const taskId = String(req.query?.taskId || "").trim();

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error: "Не указан taskId."
        });
      }

      const data = await getTask(taskId);
      const output = data?.output || {};
      const status = output.task_status || "UNKNOWN";

      if (status === "SUCCEEDED") {
        const videoUrl = output.video_url || output.results?.[0]?.video_url || "";

        if (!videoUrl) {
          return res.status(502).json({
            success: false,
            error: "Alibaba Cloud завершил задачу, но не вернул видео."
          });
        }

        return res.status(200).json({
          success: true,
          status,
          done: true,
          videoUrl,
          provider: "Alibaba Cloud Model Studio",
          model: "Wan 2.2 I2V Flash",
          duration: 5
        });
      }

      if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
        return res.status(200).json({
          success: false,
          status,
          done: true,
          error: normalizeAlibabaError(
            output,
            "Alibaba Cloud не смог создать видео."
          )
        });
      }

      return res.status(200).json({
        success: true,
        status,
        done: false,
        provider: "Alibaba Cloud Model Studio",
        model: "Wan 2.2 I2V Flash"
      });
    }

    // POST /api/video — create an asynchronous Alibaba video task.
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    const imageBase64 = String(body.imageBase64 || "").trim();
    const requestedResolution = String(body.resolution || "480P").toUpperCase();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Введите описание движения для видео."
      });
    }

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: "Изображение не загружено."
      });
    }

    // Vercel Functions have a limited request body. Normal editor images are small
    // enough, but protect the endpoint from accidentally huge data URLs.
    if (imageBase64.length > 4_000_000) {
      return res.status(413).json({
        success: false,
        error: "Изображение слишком большое для Vercel API."
      });
    }

    const imageUrl = await uploadImageIfNeeded(imageBase64);

    // Wan 2.2 I2V Flash always outputs 5 seconds.
    // 480P is selected to keep the free/trial path as lightweight as possible.
    const resolution =
      requestedResolution === "1080P" || requestedResolution === "720P"
        ? requestedResolution
        : "480P";

    const response = await fetch(
      getAlibabaBaseUrl() +
        "/api/v1/services/aigc/video-generation/video-synthesis",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.DASHSCOPE_API_KEY,
          "X-DashScope-Async": "enable",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "wan2.2-i2v-flash",
          input: {
            prompt,
            img_url: imageUrl
          },
          parameters: {
            resolution,
            prompt_extend: false
          }
        })
      }
    );

    const responseText = await response.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        "Alibaba non-JSON response",
        response.status,
        responseText.slice(0, 1000)
      );

      return res.status(502).json({
        success: false,
        error: "Alibaba Cloud вернул не JSON.",
        status: response.status
      });
    }

    if (!response.ok || data?.code) {
      const message = normalizeAlibabaError(
        data,
        "Alibaba Cloud не смог запустить генерацию."
      );

      console.error("Alibaba Wan 2.2 create error", {
        status: response.status,
        code: data?.code,
        message
      });

      return res.status(response.status || 502).json({
        success: false,
        error: message,
        provider: "Alibaba Cloud Model Studio"
      });
    }

    const taskId = data?.output?.task_id;

    if (!taskId) {
      console.error("Alibaba response without task_id", data);

      return res.status(502).json({
        success: false,
        error: "Alibaba Cloud не вернул task_id."
      });
    }

    return res.status(200).json({
      success: true,
      done: false,
      taskId,
      status: data?.output?.task_status || "PENDING",
      provider: "Alibaba Cloud Model Studio",
      model: "Wan 2.2 I2V Flash",
      duration: 5,
      resolution
    });
  } catch (error) {
    console.error("Alibaba video API error:", error);

    return res.status(500).json({
      success: false,
      error:
        error && error.message
          ? error.message
          : "Ошибка видеогенерации."
    });
  }
}
