const LIGHTNING_SPACE =
  "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
const LIGHTNING_ENDPOINT = "/generate_video";
const PIXELSTER = "https://ahm7xmakki.com/api";

function isUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function authHeaders() {
  const token = String(process.env.HF_TOKEN || "").trim();
  return token ? { Authorization: "Bearer " + token } : {};
}

function dataUrlToBlob(dataUrl) {
  const value = String(dataUrl || "");
  const comma = value.indexOf(",");
  if (comma < 0) throw new Error("Некорректный image data URL.");

  const header = value.slice(0, comma);
  const mime =
    (header.match(/^data:([^;]+);base64$/i)?.[1] || "image/jpeg").trim();
  const bytes = Buffer.from(value.slice(comma + 1), "base64");

  if (!bytes.length) throw new Error("Пустое исходное изображение.");
  if (bytes.length > 8_000_000) {
    throw new Error("Изображение слишком большое для видео.");
  }

  return new Blob([bytes], { type: mime });
}

async function normalizeImage(imageBase64, imageUrl) {
  const value = String(imageBase64 || "").trim();

  if (value.startsWith("data:image/")) {
    return value;
  }

  if (isUrl(imageUrl)) {
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": "Miya-AI/1.0" }
    });

    if (!response.ok) {
      throw new Error(
        "Не удалось получить исходное изображение: HTTP " + response.status
      );
    }

    const mime = (
      response.headers.get("content-type") || "image/jpeg"
    ).split(";")[0];

    if (!mime.startsWith("image/")) {
      throw new Error("Источник не является изображением.");
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.length > 8_000_000) {
      throw new Error("Изображение слишком большое для видео.");
    }

    return "data:" + mime + ";base64," + bytes.toString("base64");
  }

  throw new Error("Исходное изображение не найдено.");
}

function taskIdFor(task) {
  return Buffer.from(JSON.stringify(task), "utf8").toString("base64url");
}

function taskFromId(id) {
  try {
    return JSON.parse(
      Buffer.from(String(id), "base64url").toString("utf8")
    );
  } catch {
    throw new Error("Некорректный taskId.");
  }
}

function buildWanPrompt(prompt) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();

  if (!text) return text;

  return [
    "Preserve the identity, appearance, clothing, proportions, and main objects from the input image.",
    "Subject and scene: " + text + ".",
    "Motion: make the described physical action clearly visible, continuous, and physically natural.",
    "Camera: subtle cinematic movement that supports the action while keeping the subject coherent.",
    "Timing: start the action immediately, develop it continuously, and reach the described final beat by the end.",
    "Realistic motion, stable composition, consistent lighting, natural body mechanics."
  ].join(" ");
}

function providerFileUrl(url) {
  if (/^https?:\/\//i.test(String(url))) return String(url);

  return (
    LIGHTNING_SPACE +
    "/gradio_api/file=" +
    String(url).replace(/^\//, "")
  );
}

function extractCandidate(value) {
  if (!value) return null;

  if (typeof value === "string") {
    if (/\.mp4(?:$|\?)/i.test(value)) return value;
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractCandidate(item);
      if (found) return found;
    }
    return null;
  }

  const candidates = [
    value.url,
    value.path,
    value.videoUrl,
    value.video?.url,
    value.video?.path,
    value.data?.url,
    value.data?.path
  ];

  for (const candidate of candidates) {
    if (candidate && /\.mp4(?:$|\?)/i.test(String(candidate))) {
      return String(candidate);
    }
  }

  return null;
}

function extractVideoUrl(data) {
  return extractCandidate(data);
}

function getErrorMessage(error) {
  if (!error) return "Неизвестная ошибка.";

  if (typeof error === "string") return error;

  return (
    error.message ||
    error.error ||
    error.detail ||
    error?.data?.error ||
    JSON.stringify(error)
  );
}

/*
 * IMPORTANT:
 * The previous implementation manually constructed the Gradio upload/call
 * protocol. That was returning 404 from the public Wan Space.
 *
 * We use Gradio 6 REST directly: upload -> POST call -> SSE GET.
 * This avoids the queue/session mismatch that produced the 404 response.
 */
async function gradioJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    throw new Error(
      "HTTP " + response.status + ": " + (text || response.statusText || "Not Found").slice(0, 700)
    );
  }

  return data;
}

async function getLightningApi() {
  const info = await gradioJson(
    LIGHTNING_SPACE + "/gradio_api/info"
  );

  const named = info?.named_endpoints || {};
  const names = Object.keys(named);

  const endpoint =
    names.find((name) => /generate_video/i.test(name)) ||
    LIGHTNING_ENDPOINT;

  const endpointName = String(endpoint).replace(/^\/+/, "");

  return {
    info,
    endpoint: "/" + endpointName,
    endpointInfo: named[endpoint] || named["/" + endpointName] || null
  };
}

async function uploadLightningImage(image) {
  const comma = image.indexOf(",");
  if (comma < 0) {
    throw new Error("Некорректный image data URL.");
  }

  const header = image.slice(0, comma);
  const mime =
    (header.match(/^data:([^;]+);base64$/i)?.[1] || "image/jpeg").trim();

  const bytes = Buffer.from(image.slice(comma + 1), "base64");

  if (!bytes.length) {
    throw new Error("Пустое исходное изображение.");
  }

  const extension =
    mime === "image/png"
      ? "png"
      : mime === "image/webp"
        ? "webp"
        : "jpg";

  const form = new FormData();

  form.append(
    "files",
    new Blob([bytes], { type: mime }),
    "miya-input." + extension
  );

  const response = await fetch(
    LIGHTNING_SPACE + "/gradio_api/upload",
    {
      method: "POST",
      headers: authHeaders(),
      body: form
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      "Wan Lightning upload HTTP " +
        response.status +
        ": " +
        text.slice(0, 500)
    );
  }

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("Wan Lightning upload вернул некорректный JSON.");
  }

  const path = Array.isArray(result) ? result[0] : result?.path;

  if (!path) {
    throw new Error("Wan Lightning upload не вернул путь к изображению.");
  }

  return {
    path: String(path),
    meta: { _type: "gradio.FileData" },
    orig_name: "miya-input." + extension
  };
}

async function startLightningTask({ prompt, duration, image }) {
  const api = await getLightningApi();

  const inputImage = await uploadLightningImage(image);

  const seconds = Math.min(
    5,
    Math.max(0.5, Number(duration) || 3)
  );

  const wanPrompt = buildWanPrompt(prompt);
  const seed = Math.floor(Math.random() * 2147483647);

  /*
   * The current public Space is Gradio 6.x and exposes the following
   * generate_video inputs in this exact order:
   *
   * image, prompt, steps, negative_prompt, duration_seconds,
   * guidance_scale, guidance_scale_2, seed, randomize_seed
   */
  const data = [
    inputImage,
    wanPrompt,
    4,
    "static, frozen, blurry, low quality, distorted, deformed, extra limbs, identity change, scene change, camera teleportation, text, watermark",
    seconds,
    1,
    1,
    seed,
    false
  ];

  const endpointName = api.endpoint.replace(/^\/+/, "");

  /*
   * Gradio 6 REST API:
   * POST /gradio_api/call/<endpoint> -> { event_id }
   * GET  /gradio_api/call/<endpoint>/<event_id> -> SSE
   *
   * Some Spaces expose the versioned v2 route. Try the normal route first,
   * then v2 only if the server explicitly returns 404.
   */
  const candidates = [
    LIGHTNING_SPACE + "/gradio_api/call/" + endpointName,
    LIGHTNING_SPACE + "/gradio_api/call/v2/" + endpointName
  ];

  let response = null;
  let responseText = "";
  let callUrl = "";

  for (const candidate of candidates) {
    const r = await fetch(candidate, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ data })
    });

    const text = await r.text();

    if (r.ok) {
      response = r;
      responseText = text;
      callUrl = candidate;
      break;
    }

    if (r.status !== 404) {
      throw new Error(
        "Wan Lightning submit HTTP " +
          r.status +
          ": " +
          text.slice(0, 700)
      );
    }
  }

  if (!response) {
    throw new Error(
      "Wan Lightning: 404: Not Found. " +
        "Не найден REST endpoint generate_video в Gradio Space."
    );
  }

  let payload;

  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error(
      "Wan Lightning submit вернул некорректный JSON: " +
        responseText.slice(0, 500)
    );
  }

  const eventId = String(payload?.event_id || "").trim();

  if (!eventId) {
    throw new Error(
      "Wan Lightning submit не вернул event_id: " +
        responseText.slice(0, 500)
    );
  }

  const task = {
    v: 8,
    provider: "huggingface",
    model: "wan22-lightning",
    space: LIGHTNING_SPACE,
    endpoint: api.endpoint,
    callUrl,
    eventId,
    prompt: wanPrompt,
    duration: seconds
  };

  return {
    taskId: taskIdFor(task),
    endpoint: api.endpoint,
    callUrl,
    eventId
  };
}

async function pollLightningTask(task, timeoutMs = 15000) {
  const callUrl =
    String(task.callUrl || "").replace(/\/+$/, "");

  if (!callUrl || !task.eventId) {
    throw new Error("Wan Lightning: отсутствует callUrl или event_id.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      callUrl + "/" + encodeURIComponent(String(task.eventId)),
      {
        headers: {
          ...authHeaders(),
          Accept: "text/event-stream",
          "Cache-Control": "no-cache"
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        "Wan Lightning: " +
          response.status +
          ": " +
          (text || response.statusText || "Not Found").slice(0, 700)
      );
    }

    if (!response.body) {
      return {
        done: false,
        status: "RUNNING"
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split(/\\r?\\n\\r?\\n/);
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const events = parseSseEvents(chunk);

          for (const event of events) {
            const eventName = String(event.event || "").toLowerCase();
            const data = event.data;

            if (eventName === "heartbeat") {
              continue;
            }

            if (
              eventName === "error" ||
              eventName === "unexpected_error"
            ) {
              return {
                done: true,
                success: false,
                status: "ERROR",
                error: "Wan Lightning: " + getErrorMessage(data)
              };
            }

            if (eventName === "complete") {
              const url = extractVideoUrl(data);

              if (!url) {
                return {
                  done: true,
                  success: false,
                  status: "ERROR",
                  error:
                    "Wan Lightning завершил генерацию, но MP4 не был найден в ответе."
                };
              }

              return {
                done: true,
                success: true,
                status: "COMPLETED",
                videoUrl: providerFileUrl(url)
              };
            }

            if (
              eventName === "generating" ||
              eventName === "streaming"
            ) {
              continue;
            }
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    return {
      done: false,
      status: "RUNNING"
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        done: false,
        status: "RUNNING"
      };
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function pixelsterVideo({
  prompt,
  ratio,
  duration,
  imageBase64
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(PIXELSTER + "/ptv", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        prompt: String(prompt || "").trim(),
        ratio: ratio || "9:16",
        duration: Math.min(
          20,
          Math.max(5, Number(duration) || 5)
        ),
        imageBase64
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {}

    if (response.status === 504) {
      throw new Error(
        "Motion synthesis сейчас занят и не успел ответить за 25 секунд."
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          data?.error ||
          data?.message ||
          "PixelSter HTTP " + response.status
      );
    }

    if (!data.videoUrl) {
      throw new Error("PixelSter не вернул videoUrl.");
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Motion synthesis не успел ответить за 25 секунд."
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "12mb"
    }
  }
};

export default async function handler(req, res) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const health = String(req.query?.health || "");

      if (health === "wan" || health === "1") {
        try {
          const api = await getLightningApi();
          const info = api.info;

          const endpointNames = Object.keys(
            info?.named_endpoints || {}
          );

          return res.status(200).json({
            success: true,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Fast · Lightning LoRA · 4 steps",
            space: LIGHTNING_SPACE,
            endpoint: api.endpoint,
            endpoints: endpointNames,
            authenticated: Boolean(process.env.HF_TOKEN),
            free: true,
            client: "Gradio 6 REST API"
          });
        } catch (error) {
          return res.status(502).json({
            success: false,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Lightning · 4 steps",
            space: LIGHTNING_SPACE,
            authenticated: Boolean(process.env.HF_TOKEN),
            error:
              "Не удалось подключиться к Wan Lightning через Gradio Client: " +
              getErrorMessage(error)
          });
        }
      }

      const taskId = String(req.query?.taskId || "").trim();

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error: "Нужен taskId или health=1."
        });
      }

      const task = taskFromId(taskId);

      if (
        task.v !== 8 ||
        task.provider !== "huggingface" ||
        !task.eventId ||
        !task.space ||
        !task.callUrl
      ) {
        return res.status(400).json({
          success: false,
          error: "Некорректная задача видео."
        });
      }

      /*
       * raw=1 streams the finished MP4 through Vercel instead of exposing
       * the temporary Hugging Face file URL to the browser.
       */
      const raw = String(req.query?.raw || "") === "1";

      if (raw) {
        const status = await pollLightningTask(task, 12000);

        if (!status.done) {
          return res.status(202).json({
            success: true,
            done: false,
            status: status.status || "RUNNING",
            taskId
          });
        }

        if (!status.success || !status.videoUrl) {
          return res.status(502).json({
            success: false,
            done: true,
            status: "ERROR",
            error: status.error || "Видео не готово.",
            taskId
          });
        }

        const upstream = await fetch(status.videoUrl, {
          headers: {
            ...authHeaders(),
            "User-Agent": "Miya-AI/1.0"
          }
        });

        if (!upstream.ok || !upstream.body) {
          return res.status(502).json({
            success: false,
            done: true,
            error:
              "Не удалось получить MP4 от Hugging Face: HTTP " +
              upstream.status,
            taskId
          });
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader(
          "Content-Disposition",
          'inline; filename="miya-ai-video.mp4"'
        );
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate"
        );
        res.setHeader("X-Content-Type-Options", "nosniff");

        const reader = upstream.body.getReader();

        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            res.write(Buffer.from(chunk.value));
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {}
        }

        return res.end();
      }

      const status = await pollLightningTask(task, 12000);

      if (!status.done) {
        return res.status(200).json({
          success: true,
          done: false,
          status: status.status || "RUNNING",
          provider: "Hugging Face ZeroGPU",
          model: "Wan 2.2 I2V Lightning · 4 steps",
          taskId
        });
      }

      if (!status.success || !status.videoUrl) {
        return res.status(200).json({
          success: false,
          done: true,
          status: "ERROR",
          error:
            status.error ||
            "Wan Lightning завершил задачу без готового MP4.",
          provider: "Hugging Face ZeroGPU",
          model: "Wan 2.2 I2V Lightning · 4 steps",
          taskId
        });
      }

      return res.status(200).json({
        success: true,
        done: true,
        status: "COMPLETED",
        videoUrl:
          "/api/video?taskId=" +
          encodeURIComponent(taskId) +
          "&raw=1",
        provider: "Hugging Face ZeroGPU",
        model: "Wan 2.2 I2V Lightning · 4 steps",
        audioAttached: false,
        taskId
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          success: false,
          error: "Некорректный JSON запроса."
        });
      }
    }

    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Введите сценарий движения."
      });
    }

    const image = await normalizeImage(
      body.imageBase64,
      body.imageUrl
    );

    const duration = Math.min(
      5,
      Math.max(0.5, Number(body.duration) || 3)
    );

    const model = String(body.model || "wan22").trim();

    if (
      model === "ltx25" ||
      model === "hunyuan" ||
      model === "wan5b"
    ) {
      return res.status(501).json({
        success: false,
        error:
          "Сейчас для быстрого видео используется только Wan 2.2 I2V Lightning.",
        code: "VIDEO_MODEL_DISABLED",
        model
      });
    }

    if (model === "pixelster-motion") {
      try {
        const data = await pixelsterVideo({
          prompt,
          ratio: body.aspect || body.ratio || "9:16",
          duration: Math.max(5, duration),
          imageBase64: image
        });

        return res.status(200).json({
          success: true,
          done: true,
          videoUrl: data.videoUrl,
          provider: "AHM7 PixelSter",
          model: "Motion synthesis",
          audioAttached: false
        });
      } catch (error) {
        return res.status(504).json({
          success: false,
          done: true,
          error:
            error?.message ||
            "Motion synthesis не успел ответить.",
          code: "PIXELSTER_TIMEOUT",
          provider: "AHM7 PixelSter",
          model: "Motion synthesis"
        });
      }
    }

    if (model !== "wan22") {
      return res.status(400).json({
        success: false,
        error: "Неизвестная модель видео: " + model,
        code: "UNKNOWN_VIDEO_MODEL"
      });
    }

    const task = await startLightningTask({
      prompt,
      duration,
      image
    });

    return res.status(202).json({
      success: true,
      done: false,
      taskId: task.taskId,
      status: "QUEUED",
      provider: "Hugging Face ZeroGPU",
      model: "Wan 2.2 I2V Lightning · 4 steps",
      endpoint: task.endpoint,
      message:
        "Wan Lightning: 4 шага, 16 fps, 0.5–5 секунд. Публичный ZeroGPU может иметь очередь."
    });
  } catch (error) {
    console.error("Miya video API:", error);

    const status =
      Number(error?.statusCode) >= 400 &&
      Number(error?.statusCode) < 500
        ? Number(error.statusCode)
        : 502;

    return res.status(status).json({
      success: false,
      error:
        error?.message ||
        "Ошибка видео API.",
      code:
        error?.code ||
        "VIDEO_PROVIDER_ERROR"
    });
  }
}
