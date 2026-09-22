const H3_SPACE = "https://rioshiina-minimax-h3.hf.space";
const H3_INFO = H3_SPACE + "/gradio_api/info";
const WAN_SPACE = "https://saravutw-wan2-2-i2v-lightning-4-8step-custom.hf.space";
const WAN_INFO = WAN_SPACE + "/gradio_api/info";
const PIXELSTER = "https://ahm7xmakki.com/api";

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

function authHeaders() {
  const token = String(process.env.HF_TOKEN || "").trim();
  return token ? { Authorization: "Bearer " + token } : {};
}

async function fetchText(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const text = await r.text();
  if (!r.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.error || j.message || text;
    } catch {}
    throw new Error("HTTP " + r.status + ": " + String(detail).slice(0, 900));
  }
  return text;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Провайдер вернул не JSON.");
  }
}

function isUrl(v) {
  try {
    return /^https?:$/.test(new URL(String(v || "")).protocol);
  } catch {
    return false;
  }
}

async function normalizeImage(base, url) {
  if (String(base || "").startsWith("data:image/")) return String(base);

  if (!isUrl(url)) {
    throw new Error("Исходное изображение не найдено.");
  }

  const r = await fetch(url);
  if (!r.ok) {
    throw new Error("Не удалось получить исходное изображение: HTTP " + r.status);
  }

  const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  const bytes = Buffer.from(await r.arrayBuffer());

  if (!mime.startsWith("image/")) {
    throw new Error("Источник вернул не изображение.");
  }

  return "data:" + mime + ";base64," + bytes.toString("base64");
}

function taskIdFor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function taskFromId(value) {
  try {
    return JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8")
    );
  } catch {
    throw new Error("Некорректный taskId.");
  }
}

function buildPrompt(prompt) {
  const clean = String(prompt || "").replace(/\s+/g, " ").trim();

  return [
    "Animate the input image while preserving the exact identity, face, clothing, body proportions, objects and environment.",
    "Motion scenario: " + clean + ".",
    "Create one continuous primary physical action from the first frame to the last frame.",
    "Natural realistic body mechanics, stable anatomy, coherent temporal motion, consistent lighting and materials.",
    "Subtle cinematic camera movement. Keep the original composition and subject recognizable.",
    "Photorealistic cinematic video, smooth motion, no text, no watermark."
  ].join(" ");
}

function dimensionsFor(ratio) {
  switch (String(ratio || "16:9")) {
    case "9:16":
      return { width: 544, height: 960 };
    case "1:1":
      return { width: 544, height: 544 };
    case "4:3":
      return { width: 640, height: 480 };
    default:
      return { width: 960, height: 544 };
  }
}

function extractVideo(value) {
  if (!value) return null;

  if (typeof value === "string") {
    if (/\.mp4(?:$|\?)/i.test(value) || /gradio_api\/file=/i.test(value)) {
      return value;
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractVideo(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const key of [
      "video",
      "videoUrl",
      "url",
      "path",
      "video_path",
      "output",
      "result",
      "videos",
      "data"
    ]) {
      const found = extractVideo(value[key]);
      if (found) return found;
    }
  }

  return null;
}

function h3FileUrl(value) {
  if (isUrl(value)) return value;

  const raw = String(value || "");
  if (!raw) return null;

  return H3_SPACE + "/gradio_api/file=" + encodeURIComponent(raw);
}

async function h3Call(endpoint, data) {
  const r = await fetch(H3_SPACE + "/gradio_api/call/" + endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ data })
  });

  const text = await r.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}

  if (!r.ok || !json.event_id) {
    throw new Error(
      "MiniMax H3 start HTTP " +
        r.status +
        ": " +
        String(json.error || text || "event_id отсутствует").slice(0, 900)
    );
  }

  return json.event_id;
}

async function readSse(url, timeout = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const r = await fetch(url, {
      headers: {
        ...authHeaders(),
        Accept: "text/event-stream"
      },
      signal: controller.signal
    });

    if (r.status === 404) {
      return { kind: "queued" };
    }

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error("SSE HTTP " + r.status + ": " + detail.slice(0, 700));
    }

    if (!r.body) {
      return { kind: "running" };
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "";
    let lastData = null;

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });

      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";

      for (const part of parts) {
        let raw = "";

        for (const line of part.split(/\r?\n/)) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          }
          if (line.startsWith("data:")) {
            raw += line.slice(5).trim();
          }
        }

        if (!raw) continue;

        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }

        lastData = parsed;

        if (
          eventName === "error" ||
          eventName === "unexpected_error"
        ) {
          return {
            kind: "error",
            error:
              typeof parsed === "string"
                ? parsed
                : parsed?.error || parsed?.message || "Провайдер вернул ошибку."
          };
        }

        if (eventName === "complete") {
          return { kind: "complete", data: parsed };
        }
      }
    }

    return lastData
      ? { kind: "data", data: lastData }
      : { kind: "running" };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { kind: "running" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function startH3(prompt, duration, image, ratio) {
  const { width, height } = dimensionsFor(ratio);

  const seconds = Math.min(5, Math.max(3, Number(duration) || 3));

  const params = {
    task_type: "i2va",
    prompt: buildPrompt(prompt),
    width,
    height,
    duration: seconds,
    first_frame_image: image,
    seed: -1,
    zero_gpu_duration: 120,
    async_execution: true
  };

  const eventId = await h3Call("run", [JSON.stringify(params)]);

  return {
    taskId: taskIdFor({
      version: 6,
      provider: "h3",
      eventId,
      model: "MiniMax H3 I2V",
      duration: seconds,
      ratio: String(ratio || "16:9")
    })
  };
}

async function pollH3(task, timeout = 9000) {
  // The H3 public Space exposes a two-stage async API:
  // 1) /run returns its own event and creates a task_id.
  // 2) /get_task_status is then called with that task_id.
  if (task.phase === "run") {
    const event = await readSse(
      H3_SPACE +
        "/gradio_api/call/run/" +
        encodeURIComponent(task.eventId),
      timeout
    );

    if (event.kind === "error") {
      return {
        done: true,
        success: false,
        error: event.error || "MiniMax H3 start error"
      };
    }

    if (event.kind !== "complete" && event.kind !== "data") {
      return { done: false, status: "QUEUED" };
    }

    const payload = event.data;
    if (payload?.error) {
      return {
        done: true,
        success: false,
        error: payload.error.message || payload.error
      };
    }

    const h3TaskId = payload?.task_id;
    if (!h3TaskId) {
      return {
        done: false,
        status: "QUEUED"
      };
    }

    return {
      done: false,
      status: String(payload.status || "QUEUED").toUpperCase(),
      taskId: taskIdFor({
        ...task,
        phase: "status",
        h3TaskId
      })
    };
  }

  if (!task.h3TaskId) {
    return {
      done: true,
      success: false,
      error: "MiniMax H3 не вернул внутренний task_id."
    };
  }

  const start = await fetch(H3_SPACE + "/gradio_api/call/get_task_status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ data: [task.h3TaskId] })
  });

  const startText = await start.text();
  let startJson = {};
  try {
    startJson = startText ? JSON.parse(startText) : {};
  } catch {}

  if (!start.ok || !startJson.event_id) {
    throw new Error(
      "MiniMax H3 status HTTP " +
        start.status +
        ": " +
        String(startJson.error || startText || "event_id отсутствует").slice(0, 700)
    );
  }

  const event = await readSse(
    H3_SPACE +
      "/gradio_api/call/get_task_status/" +
      encodeURIComponent(startJson.event_id),
    timeout
  );

  if (event.kind === "error") {
    return {
      done: true,
      success: false,
      error: event.error || "MiniMax H3 status error"
    };
  }

  if (event.kind !== "complete" && event.kind !== "data") {
    return { done: false, status: "PROCESSING" };
  }

  const payload = event.data || {};
  const status = String(payload.status || "").toLowerCase();

  if (status === "failed" || status === "error") {
    return {
      done: true,
      success: false,
      error:
        payload?.error?.message ||
        payload?.error?.detail ||
        payload?.error ||
        "MiniMax H3 завершил задачу с ошибкой."
    };
  }

  if (status !== "completed") {
    return {
      done: false,
      status: status || "PROCESSING",
      progress: payload.progress ?? null
    };
  }

  const result = payload.result || {};
  const rawVideo =
    extractVideo(result.videos) ||
    extractVideo(result.video_path) ||
    extractVideo(result);

  const videoUrl = h3FileUrl(rawVideo);

  if (!videoUrl) {
    return {
      done: true,
      success: false,
      error: "MiniMax H3 завершил задачу, но не вернул MP4."
    };
  }

  return {
    done: true,
    success: true,
    videoUrl,
    duration: result.duration,
    width: result.width,
    height: result.height
  };
}

async function startWan(prompt, duration, image) {
  const info = await fetchJson(WAN_INFO, {
    headers: { Accept: "application/json" }
  });

  const names = Object.keys(info?.named_endpoints || info?.endpoints || {});
  const endpoint =
    (
      names.find((name) => /generate.*video|video.*generate/i.test(name)) ||
      "generate_video"
    ).replace(/^\//, "");

  const comma = image.indexOf(",");
  if (comma < 0) throw new Error("Некорректное изображение.");

  const mime =
    image.slice(5, comma).split(";")[0] || "image/jpeg";
  const bytes = Buffer.from(image.slice(comma + 1), "base64");

  const form = new FormData();
  form.append(
    "files",
    new Blob([bytes], { type: mime }),
    "miya-video.jpg"
  );

  const upload = await fetch(WAN_SPACE + "/gradio_api/upload", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });

  const uploadText = await upload.text();
  let uploadJson = null;
  try {
    uploadJson = JSON.parse(uploadText);
  } catch {}

  if (!upload.ok) {
    throw new Error(
      "Wan upload HTTP " + upload.status + ": " + uploadText.slice(0, 700)
    );
  }

  const imagePath = Array.isArray(uploadJson)
    ? uploadJson[0]
    : uploadJson?.path;

  if (!imagePath) {
    throw new Error("Wan не вернул путь загруженного изображения.");
  }

  const seconds = Math.min(5, Math.max(3, Number(duration) || 3));

  const data = [
    {
      path: imagePath,
      meta: { _type: "gradio.FileData" },
      orig_name: "miya-video.jpg"
    },
    null,
    buildPrompt(prompt),
    4,
    "static, frozen, blurry, low quality, distorted, deformed, extra limbs, identity change, scene change, text, watermark",
    seconds,
    1,
    1,
    Math.floor(Math.random() * 2147483647),
    true,
    5,
    "UniPCMultistep",
    3,
    16,
    false,
    true
  ];

  const r = await fetch(
    WAN_SPACE + "/gradio_api/call/" + endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ data })
    }
  );

  const text = await r.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}

  if (!r.ok || !json.event_id) {
    throw new Error(
      "Wan start HTTP " +
        r.status +
        ": " +
        String(json.error || text || "event_id отсутствует").slice(0, 800)
    );
  }

  return {
    taskId: taskIdFor({
      version: 4,
      provider: "wan",
      space: WAN_SPACE,
      endpoint,
      eventId: json.event_id,
      model: "Wan 2.2 I2V Lightning",
      duration: seconds
    })
  };
}

async function pollWan(task, timeout = 9000) {
  const event = await readSse(
    task.space +
      "/gradio_api/call/" +
      task.endpoint +
      "/" +
      encodeURIComponent(task.eventId),
    timeout
  );

  if (event.kind === "error") {
    return {
      done: true,
      success: false,
      error: event.error || "Wan error"
    };
  }

  if (event.kind !== "complete" && event.kind !== "data") {
    return { done: false, status: "QUEUED" };
  }

  const rawVideo = extractVideo(event.data);
  if (!rawVideo) {
    return { done: false, status: "PROCESSING" };
  }

  return {
    done: true,
    success: true,
    videoUrl: isUrl(rawVideo)
      ? rawVideo
      : WAN_SPACE + "/gradio_api/file=" + encodeURIComponent(rawVideo)
  };
}

async function pixelster(prompt, image, ratio, duration) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const r = await fetch(PIXELSTER + "/ptv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        ratio,
        duration,
        imageBase64: image
      }),
      signal: controller.signal
    });

    const text = await r.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {}

    if (!r.ok || !data.videoUrl) {
      throw new Error(
        data.error || data.message || "PixelSter video error"
      );
    }

    return data.videoUrl;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const health = String(req.query?.health || "");

      if (health === "h3") {
        try {
          const info = await fetchJson(H3_INFO, {
            headers: { Accept: "application/json" }
          });

          return res.status(200).json({
            success: true,
            provider: "Hugging Face ZeroGPU",
            model: "MiniMax H3 · I2V",
            space: H3_SPACE,
            endpoint: "run",
            free: true,
            tokenOptional: !process.env.HF_TOKEN
          });
        } catch (error) {
          return res.status(502).json({
            success: false,
            provider: "Hugging Face ZeroGPU",
            model: "MiniMax H3 · I2V",
            space: H3_SPACE,
            error: error?.message || "H3 недоступен."
          });
        }
      }

      if (health === "wan") {
        try {
          const info = await fetchJson(WAN_INFO, {
            headers: { Accept: "application/json" }
          });

          return res.status(200).json({
            success: true,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Lightning",
            space: WAN_SPACE,
            endpoints: Object.keys(
              info?.named_endpoints || info?.endpoints || {}
            ),
            free: true
          });
        } catch (error) {
          return res.status(502).json({
            success: false,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Lightning",
            space: WAN_SPACE,
            error: error?.message || "Wan недоступен."
          });
        }
      }

      const id = String(req.query?.taskId || "");
      if (!id) {
        return res.status(400).json({
          success: false,
          error: "Нужен taskId."
        });
      }

      const task = taskFromId(id);

      if (task.version === 6 && task.provider === "h3") {
        const status = await pollH3(task);

        if (!status.done) {
          return res.status(200).json({
            success: true,
            done: false,
            status: status.status || "PROCESSING",
            progress: status.progress,
            provider: "Hugging Face ZeroGPU",
            model: "MiniMax H3 · I2V",
            taskId: id
          });
        }

        if (!status.success) {
          return res.status(200).json({
            success: false,
            done: true,
            status: "ERROR",
            error:
              status.error ||
              "MiniMax H3 не смог создать видео.",
            provider: "Hugging Face ZeroGPU",
            model: "MiniMax H3 · I2V",
            taskId: id
          });
        }

        return res.status(200).json({
          success: true,
          done: true,
          status: "COMPLETED",
          videoUrl: status.videoUrl,
          provider: "Hugging Face ZeroGPU",
          model: "MiniMax H3 · I2V",
          audioAttached: true,
          taskId: id
        });
      }

      if (task.version === 4 && task.provider === "wan") {
        const status = await pollWan(task);

        if (!status.done) {
          return res.status(200).json({
            success: true,
            done: false,
            status: status.status || "PROCESSING",
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Lightning",
            taskId: id
          });
        }

        if (!status.success) {
          return res.status(200).json({
            success: false,
            done: true,
            status: "ERROR",
            error:
              status.error ||
              "Wan не смог создать видео.",
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Lightning",
            taskId: id
          });
        }

        return res.status(200).json({
          success: true,
          done: true,
          status: "COMPLETED",
          videoUrl: status.videoUrl,
          provider: "Hugging Face ZeroGPU",
          model: "Wan 2.2 I2V Lightning",
          audioAttached: false,
          taskId: id
        });
      }

      return res.status(400).json({
        success: false,
        error: "Неизвестная версия задачи. Запустите генерацию заново."
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    let body = req.body || {};
    if (typeof body === "string") body = JSON.parse(body);

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

    const model = String(body.model || "h3");
    const duration = Math.min(
      5,
      Math.max(3, Number(body.duration) || 3)
    );

    if (model === "pixelster-motion") {
      const videoUrl = await pixelster(
        prompt,
        image,
        body.aspect || "16:9",
        duration
      );

      return res.status(200).json({
        success: true,
        done: true,
        videoUrl,
        provider: "AHM7 PixelSter",
        model: "Motion synthesis",
        audioAttached: false
      });
    }

    if (model === "wan22") {
      const task = await startWan(
        prompt,
        duration,
        image
      );

      return res.status(202).json({
        success: true,
        done: false,
        taskId: task.taskId,
        status: "QUEUED",
        provider: "Hugging Face ZeroGPU",
        model: "Wan 2.2 I2V Lightning"
      });
    }

    // H3 is the primary route. The public Space exposes an async
    // high-level API specifically designed for i2va, so we do not keep
    // a Vercel function open while the GPU is running.
    const task = await startH3(
      prompt,
      duration,
      image,
      body.aspect || "16:9"
    );

    return res.status(202).json({
      success: true,
      done: false,
      taskId: task.taskId,
      status: "QUEUED",
      provider: "Hugging Face ZeroGPU",
      model: "MiniMax H3 · I2V",
      audioAttached: true
    });
  } catch (error) {
    console.error("Miya video API:", error);

    return res.status(502).json({
      success: false,
      error:
        error?.message ||
        "Ошибка видеопровайдера.",
      code: "VIDEO_PROVIDER_ERROR"
    });
  }
}
