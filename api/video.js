const LTX_SPACE =
  "https://rahul7star-ltx-2-3-turbo.hf.space";
const LTX_ENDPOINT = "generate_video";
const PIXELSTER = "https://ahm7xmakki.com/api";

function authHeaders() {
  const token = String(process.env.HF_TOKEN || "").trim();
  return token ? { Authorization: "Bearer " + token } : {};
}

function isUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function taskIdFor(task) {
  return Buffer.from(JSON.stringify(task), "utf8").toString("base64url");
}

function taskFromId(id) {
  try {
    return JSON.parse(Buffer.from(String(id), "base64url").toString("utf8"));
  } catch {
    throw new Error("Некорректный taskId.");
  }
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

function buildLtxPrompt(prompt) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) return text;

  return [
    "Preserve the identity, appearance, clothing, proportions and main objects from the input image.",
    "Scene and action: " + text + ".",
    "Motion must be continuous, physically natural and clearly visible.",
    "Use subtle cinematic camera movement while keeping the subject stable and recognizable.",
    "Start the action immediately and reach the described final beat by the end.",
    "Generate synchronized natural audio matching the visible action and environment.",
    "Cinematic realism, coherent lighting, realistic materials, stable anatomy, no text or watermark."
  ].join(" ");
}

async function fetchJson(url, options = {}) {
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
      "HTTP " +
        response.status +
        ": " +
        (text || response.statusText || "Unknown error").slice(0, 900)
    );
  }

  return data;
}

async function getLtxInfo() {
  return fetchJson(LTX_SPACE + "/gradio_api/info");
}

function parseSseChunk(chunk) {
  const lines = String(chunk || "").split(/\r?\n/);
  let event = "";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) return null;

  const raw = dataLines.join("\n");

  let data = raw;
  try {
    data = JSON.parse(raw);
  } catch {}

  return { event, data };
}

function findVideo(value) {
  if (!value) return null;

  if (typeof value === "string") {
    if (value.startsWith("data:video/")) return value;
    if (/\.mp4(?:$|\?)/i.test(value)) return value;
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideo(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    const candidates = [
      value.video,
      value.url,
      value.path,
      value.videoUrl,
      value.data,
      value.output,
      value.result
    ];

    for (const candidate of candidates) {
      const found = findVideo(candidate);
      if (found) return found;
    }
  }

  return null;
}

async function uploadLtxImage(dataUri) {
  const comma = String(dataUri || "").indexOf(",");
  if (comma < 0) throw new Error("Некорректное data:image изображение.");

  const header = String(dataUri).slice(0, comma);
  const mime =
    header.match(/^data:([^;]+);base64$/i)?.[1] || "image/png";
  const bytes = Buffer.from(String(dataUri).slice(comma + 1), "base64");

  const form = new FormData();
  form.append(
    "files",
    new Blob([bytes], { type: mime }),
    "miya-input." + (mime === "image/jpeg" ? "jpg" : "png")
  );

  const response = await fetch(LTX_SPACE + "/gradio_api/upload", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      "LTX-2.3 Turbo upload HTTP " +
        response.status +
        ": " +
        text.slice(0, 900)
    );
  }

  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("LTX-2.3 Turbo upload вернул некорректный JSON.");
  }

  const item = Array.isArray(payload) ? payload[0] : payload;
  const path =
    typeof item === "string"
      ? item
      : item?.path || item?.name || item?.url;

  if (!path) {
    throw new Error(
      "LTX-2.3 Turbo не вернул путь загруженного изображения: " +
        text.slice(0, 700)
    );
  }

  return {
    path,
    meta: { _type: "gradio.FileData" },
    ...(item && typeof item === "object" ? item : {})
  };
}

async function submitLtx({
  image,
  prompt,
  duration,
  aspect = "9:16"
}) {
  const info = await getLtxInfo();

  const named = info?.named_endpoints || {};
  const endpointNames = Object.keys(named);
  const endpointName =
    endpointNames.find((name) => name.replace(/^\//, "") === LTX_ENDPOINT) ||
    endpointNames.find((name) => /generate_video/i.test(name)) ||
    LTX_ENDPOINT;

  const seconds = Math.min(5, Math.max(2, Math.round(Number(duration) || 5)));

  let width = 768;
  let height = 512;
  if (aspect === "9:16") {
    width = 512;
    height = 768;
  } else if (aspect === "1:1") {
    width = 512;
    height = 512;
  }

  // Gradio gr.Image(type="filepath") requires a file upload first.
  const imageFile = await uploadLtxImage(image);

  // generate_video(first_frame, end_frame, prompt, duration, generation_mode,
  // enhance_prompt, seed, randomize_seed, height, width, audio_path)
  const data = [
    imageFile,
    null,
    buildLtxPrompt(prompt),
    seconds,
    "Image-to-Video",
    true,
    -1,
    true,
    height,
    width,
    null
  ];

  const url =
    LTX_SPACE +
    "/gradio_api/call/" +
    String(endpointName).replace(/^\/+/, "");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ data })
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      "LTX-2.3 submit HTTP " +
        response.status +
        ": " +
        text.slice(0, 900)
    );
  }

  let payload;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      "LTX-2.3 submit вернул некорректный JSON: " + text.slice(0, 700)
    );
  }

  const eventId = String(payload?.event_id || "").trim();

  if (!eventId) {
    throw new Error(
      "LTX-2.3 не вернул event_id: " + text.slice(0, 700)
    );
  }

  return {
    taskId: taskIdFor({
      v: 11,
      provider: "huggingface",
      model: "ltx23turbo",
      space: LTX_SPACE,
      callUrl: url,
      eventId,
      prompt: String(prompt || "").trim(),
      duration: seconds,
      aspect,
      resolution: aspect
    }),
    endpoint: "/" + String(endpointName).replace(/^\/+/, ""),
    eventId
  };
}

async function pollLtxTask(task, timeoutMs = 12000) {
  const callUrl = String(task.callUrl || "").replace(/\/+$/, "");

  if (!callUrl || !task.eventId) {
    throw new Error("LTX-2.3: отсутствует callUrl или event_id.");
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
        "LTX-2.3 SSE HTTP " +
          response.status +
          ": " +
          (text || response.statusText || "Not Found").slice(0, 900)
      );
    }

    if (!response.body) {
      return { done: false, status: "RUNNING" };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const parsed = parseSseChunk(chunk);
          if (!parsed) continue;

          const eventName = String(parsed.event || "").toLowerCase();
          const data = parsed.data;

          if (eventName === "heartbeat" || eventName === "generating") {
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
              error: "LTX-2.3: " + getErrorMessage(data)
            };
          }

          if (eventName === "complete") {
            const videoUrl = findVideo(data);

            if (!videoUrl) {
              return {
                done: true,
                success: false,
                status: "ERROR",
                error:
                  "LTX-2.3 завершил генерацию, но MP4 не найден в ответе."
              };
            }

            return {
              done: true,
              success: true,
              status: "COMPLETED",
              videoUrl
            };
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    return { done: false, status: "RUNNING" };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { done: false, status: "RUNNING" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function normalizeImage(imageBase64, imageUrl) {
  const value = String(imageBase64 || "").trim();

  if (value.startsWith("data:image/")) {
    if (value.length > 11_000_000) {
      throw new Error("Изображение слишком большое для LTX-2.3.");
    }
    return value;
  }

  if (isUrl(imageUrl)) {
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": "Miya-AI/1.0" }
    });

    if (!response.ok) {
      throw new Error(
        "Не удалось получить исходное изображение: HTTP " +
          response.status
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

async function pixelsterVideo({ prompt, ratio, duration, imageBase64 }) {
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
        duration: Math.min(20, Math.max(5, Number(duration) || 5)),
        imageBase64
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {}

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
      throw new Error("Motion synthesis не успел ответить за 25 секунд.");
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
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const health = String(req.query?.health || "");

      if (health === "ltx" || health === "1") {
        try {
          const info = await getLtxInfo();
          const endpoints = Object.keys(info?.named_endpoints || {});

          return res.status(200).json({
            success: true,
            provider: "Hugging Face ZeroGPU",
            model: "LTX-2.3 Turbo · 22B · audio-video",
            space: LTX_SPACE,
            endpoint: "/generate",
            endpoints,
            free: true,
            audio: true,
            imageToVideo: true,
            resolutions: ["720p", "1080p"],
            duration: "5-10s"
          });
        } catch (error) {
          return res.status(502).json({
            success: false,
            provider: "Hugging Face ZeroGPU",
            model: "LTX-2.3 Turbo",
            space: LTX_SPACE,
            error: getErrorMessage(error)
          });
        }
      }

      const taskId = String(req.query?.taskId || "").trim();

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error: "Нужен taskId или health=ltx."
        });
      }

      const task = taskFromId(taskId);

      if (
        task.v !== 11 ||
        task.provider !== "huggingface" ||
        task.model !== "ltx23turbo" ||
        !task.eventId ||
        !task.callUrl
      ) {
        return res.status(400).json({
          success: false,
          error: "Некорректная задача LTX-2.3."
        });
      }

      const raw = String(req.query?.raw || "") === "1";
      const status = await pollLtxTask(task, raw ? 12000 : 12000);

      if (!status.done) {
        return res.status(200).json({
          success: true,
          done: false,
          status: status.status || "RUNNING",
          provider: "Hugging Face ZeroGPU",
          model: "LTX-2.3 Turbo · Audio",
          taskId
        });
      }

      if (!status.success || !status.videoUrl) {
        return res.status(200).json({
          success: false,
          done: true,
          status: "ERROR",
          error: status.error || "LTX-2.3 не создал видео.",
          provider: "Hugging Face ZeroGPU",
          model: "LTX-2.3 Turbo · Audio",
          taskId
        });
      }

      if (raw) {
        if (String(status.videoUrl).startsWith("data:video/")) {
          const comma = status.videoUrl.indexOf(",");
          const header = status.videoUrl.slice(0, comma);
          const mime =
            header.match(/^data:([^;]+);base64$/i)?.[1] ||
            "video/mp4";
          const bytes = Buffer.from(
            status.videoUrl.slice(comma + 1),
            "base64"
          );

          res.statusCode = 200;
          res.setHeader("Content-Type", mime);
          res.setHeader(
            "Content-Disposition",
            'inline; filename="miya-ai-ltx23.mp4"'
          );
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Length", String(bytes.length));
          return res.end(bytes);
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
              "Не удалось получить MP4 от LTX-2.3: HTTP " +
              upstream.status,
            taskId
          });
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader(
          "Content-Disposition",
          'inline; filename="miya-ai-ltx23.mp4"'
        );
        res.setHeader("Cache-Control", "no-store");
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

      return res.status(200).json({
        success: true,
        done: true,
        status: "COMPLETED",
        videoUrl:
          "/api/video?taskId=" +
          encodeURIComponent(taskId) +
          "&raw=1",
        provider: "Hugging Face ZeroGPU",
        model: "LTX-2.3 Turbo · Audio",
        audioAttached: true,
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

    const image = await normalizeImage(body.imageBase64, body.imageUrl);
    const model = String(body.model || "ltx25").trim();

    // New primary route. Keep old model IDs accepted so the current UI does
    // not break while it is being migrated to the new label.
    if (model === "ltx25" || model === "ltx23") {
      const duration = Math.min(
        5,
        Math.max(2, Math.round(Number(body.duration) || 5))
      );

      const task = await submitLtx({
        prompt,
        duration,
        aspect: body.aspect || body.ratio || "9:16",
        image
      });

      return res.status(202).json({
        success: true,
        done: false,
        taskId: task.taskId,
        status: "QUEUED",
        provider: "Hugging Face ZeroGPU",
        model: "LTX-2.3 Turbo · Audio",
        audioAttached: true,
        endpoint: task.endpoint,
        message:
          "LTX-2.3 Turbo: Image → Video + synchronized audio. Публичный ZeroGPU может иметь очередь."
      });
    }

    if (model === "pixelster-motion") {
      try {
        const data = await pixelsterVideo({
          prompt,
          ratio: body.aspect || body.ratio || "9:16",
          duration: Math.max(5, Number(body.duration) || 5),
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
          error: error?.message || "Motion synthesis не успел ответить.",
          code: "PIXELSTER_TIMEOUT",
          provider: "AHM7 PixelSter",
          model: "Motion synthesis"
        });
      }
    }

    // Preserve the old Wan route as a clear fallback instead of silently
    // pretending it is LTX. The current UI can still select it.
    if (model === "wan22" || model === "wan5b" || model === "hunyuan") {
      return res.status(503).json({
        success: false,
        done: true,
        code: "LEGACY_VIDEO_PROVIDER_DISABLED",
        error:
          "Старый видео-провайдер временно отключён. Для теста выберите LTX-2.3 Turbo + Audio."
      });
    }

    return res.status(400).json({
      success: false,
      error: "Неизвестная модель видео: " + model,
      code: "UNKNOWN_VIDEO_MODEL"
    });
  } catch (error) {
    console.error("Miya LTX video API:", error);

    return res.status(502).json({
      success: false,
      error: getErrorMessage(error),
      code: "VIDEO_PROVIDER_ERROR"
    });
  }
}
