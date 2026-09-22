const LTX_SPACES = [
  {
    name: "LTX-2.3 Fast",
    base: "https://shaundeeooo-ltx-2-3-fast.hf.space",
    endpoint: "generate",
    mode: "fal"
  },
  {
    name: "LTX-2.3 Official",
    base: "https://lightricks-ltx-2-3.hf.space",
    endpoint: "generate_video",
    mode: "official"
  }
];
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

function errorMessage(error) {
  if (!error) return "Неизвестная ошибка.";
  if (typeof error === "string") return error;
  return error.message || error.error || error.detail || JSON.stringify(error);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    throw new Error("HTTP " + response.status + ": " + (text || response.statusText).slice(0, 1000));
  }
  return data;
}

function buildPrompt(prompt) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  return [
    "Preserve the identity, appearance, clothing, proportions and main objects from the input image.",
    "Scene and action: " + text + ".",
    "Continuous physically natural motion, stable anatomy, coherent lighting and realistic materials.",
    "Use subtle cinematic camera movement while keeping the main subject recognizable.",
    "Start the action immediately and complete the described beat within the clip.",
    "Generate synchronized natural audio matching the visible action, environment and camera scene.",
    "Cinematic photorealism, no text, no watermark."
  ].join(" ");
}

function findVideo(value, baseUrl = "") {
  if (!value) return null;
  if (typeof value === "string") {
    if (/^data:video\//i.test(value)) return value;
    if (/^https?:\/\//i.test(value) && /(?:\.mp4|file=|video)/i.test(value)) return value;
    if (/^\/(?:gradio_api\/)?file=/i.test(value) && baseUrl) return baseUrl.replace(/\/+$/, "") + value;
    if (/\.mp4(?:$|\?)/i.test(value) && baseUrl && value.startsWith("/")) return baseUrl.replace(/\/+$/, "") + value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideo(item, baseUrl);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of ["video", "url", "path", "videoUrl", "data", "output", "result"]) {
      const found = findVideo(value[key]);
      if (found) return found;
    }
  }
  return null;
}

function parseSseChunk(chunk) {
  const lines = String(chunk || "").split(/\r?\n/);
  let event = "";
  const data = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  const raw = data.join("\n");
  let parsed = raw;
  try { parsed = JSON.parse(raw); } catch {}
  return { event, data: parsed };
}

async function normalizeImage(imageBase64, imageUrl) {
  const value = String(imageBase64 || "").trim();
  if (value.startsWith("data:image/")) {
    if (value.length > 11_000_000) throw new Error("Изображение слишком большое для видео.");
    return value;
  }

  if (!isUrl(imageUrl)) throw new Error("Исходное изображение не найдено.");

  const response = await fetch(imageUrl, { headers: { "User-Agent": "Miya-AI/1.0" } });
  if (!response.ok) throw new Error("Не удалось получить исходное изображение: HTTP " + response.status);

  const mime = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error("Источник не является изображением.");

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 8_000_000) throw new Error("Изображение слишком большое для видео.");

  return "data:" + mime + ";base64," + bytes.toString("base64");
}

async function getLtxInfo() {
  const results = [];
  for (const space of LTX_SPACES) {
    try {
      const info = await fetchJson(space.base + "/gradio_api/info");
      results.push({ ...space, online: true, info });
    } catch (error) {
      results.push({ ...space, online: false, error: errorMessage(error) });
    }
  }
  return results;
}

async function uploadToGradio(spaceBase, imageDataUri) {
  const comma = imageDataUri.indexOf(",");
  if (comma < 0) throw new Error("Некорректное изображение.");
  const header = imageDataUri.slice(0, comma);
  const mime = (header.match(/^data:([^;]+)/i) || [])[1] || "image/jpeg";
  const bytes = Buffer.from(imageDataUri.slice(comma + 1), "base64");
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mime }), "miya-input." + (mime.includes("png") ? "png" : "jpg"));
  const response = await fetch(spaceBase + "/gradio_api/upload", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  const text = await response.text();
  if (!response.ok) throw new Error("LTX upload HTTP " + response.status + ": " + text.slice(0, 700));
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("LTX upload вернул некорректный JSON."); }
  const path = Array.isArray(data) ? data[0] : data?.files?.[0] || data?.path;
  if (!path) throw new Error("LTX upload не вернул путь файла.");
  return {
    path: String(path),
    orig_name: "miya-input." + (mime.includes("png") ? "png" : "jpg"),
    mime_type: mime,
    meta: { _type: "gradio.FileData" }
  };
}

async function submitOfficialLtx({ space, image, prompt, duration, aspect }) {
  const seconds = Math.min(5, Math.max(1, Number(duration) || 3));
  const dims = {
    "16:9": [1024, 576],
    "9:16": [576, 1024],
    "1:1": [768, 768],
    "4:3": [768, 576]
  };
  const [width, height] = dims[aspect] || dims["16:9"];
  const imageFile = await uploadToGradio(space.base, image);

  const data = [
    imageFile,
    buildPrompt(prompt),
    seconds,
    false,
    -1,
    true,
    height,
    width
  ];

  const candidates = [
    space.base + "/gradio_api/call/v2/" + space.endpoint,
    space.base + "/gradio_api/call/" + space.endpoint
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
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
        lastError = new Error("LTX Official submit HTTP " + response.status + ": " + text.slice(0, 700));
        continue;
      }
      let payload;
      try { payload = text ? JSON.parse(text) : null; } catch {
        lastError = new Error("LTX Official submit вернул некорректный JSON.");
        continue;
      }
      const eventId = String(payload?.event_id || "").trim();
      if (!eventId) {
        lastError = new Error("LTX Official не вернул event_id: " + text.slice(0, 500));
        continue;
      }
      return {
        taskId: taskIdFor({
          v: 13,
          provider: "huggingface",
          model: "ltx23official-audio",
          space: space.base,
          callUrl: url,
          eventId,
          prompt: String(prompt || "").trim(),
          duration: seconds,
          aspect
        }),
        endpoint: "/" + space.endpoint,
        eventId
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("LTX Official не принял запрос.");
}

async function submitLtx({ image, prompt, duration, aspect }) {
  const seconds = Math.min(10, Math.max(5, Math.round(Number(duration) || 5)));
  const resolution = aspect === "9:16" || aspect === "1:1" ? "720p" : "720p";

  // LTX-2.3 Fast exposes a Gradio 6 API endpoint named /generate.
  // The API accepts the image directly as a Base64 data URI, so no
  // separate /upload call is needed.
  const data = [
    image,
    buildPrompt(prompt),
    "",
    resolution,
    seconds,
    -1,
    "video/h264-mp4",
    true,
    true
  ];

  const fastSpace = LTX_SPACES[0];
  const candidates = [
    fastSpace.base + "/gradio_api/call/v2/" + fastSpace.endpoint,
    fastSpace.base + "/gradio_api/call/" + fastSpace.endpoint
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
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
        lastError = new Error("LTX-2.3 Fast submit HTTP " + response.status + ": " + text.slice(0, 800));
        continue;
      }

      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch {
        lastError = new Error("LTX-2.3 Fast submit вернул некорректный JSON: " + text.slice(0, 600));
        continue;
      }

      const eventId = String(payload?.event_id || "").trim();
      if (!eventId) {
        lastError = new Error("LTX-2.3 Fast не вернул event_id: " + text.slice(0, 600));
        continue;
      }

      return {
        taskId: taskIdFor({
          v: 12,
          provider: "huggingface",
          model: "ltx23fast-audio",
          space: fastSpace.base,
          callUrl: url,
          eventId,
          prompt: String(prompt || "").trim(),
          duration: seconds,
          aspect
        }),
        endpoint: "/" + LTX_ENDPOINT,
        eventId
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("LTX-2.3 Fast не принял запрос.");
}

async function pollLtxTask(task, timeoutMs = 12000) {
  const callUrl = String(task.callUrl || "").replace(/\/+$/, "");
  if (!callUrl || !task.eventId) throw new Error("LTX-2.3: отсутствует callUrl или event_id.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(callUrl + "/" + encodeURIComponent(String(task.eventId)), {
      headers: {
        ...authHeaders(),
        Accept: "text/event-stream",
        "Cache-Control": "no-cache"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error("LTX-2.3 SSE HTTP " + response.status + ": " + text.slice(0, 900));
    }

    if (!response.body) return { done: false, status: "RUNNING" };

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

          const event = String(parsed.event || "").toLowerCase();
          const data = parsed.data;

          if (event === "heartbeat" || event === "generating" || event === "progress") continue;

          if (event === "error" || event === "unexpected_error") {
            return { done: true, success: false, status: "ERROR", error: "LTX-2.3: " + errorMessage(data) };
          }

          if (event === "complete") {
            const videoUrl = findVideo(data, task.space);
            if (!videoUrl) {
              return {
                done: true,
                success: false,
                status: "ERROR",
                error: "LTX-2.3 завершил генерацию, но MP4 не найден в ответе."
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
      try { reader.releaseLock(); } catch {}
    }

    return { done: false, status: "RUNNING" };
  } catch (error) {
    if (error?.name === "AbortError") return { done: false, status: "RUNNING" };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function pixelsterVideo({ prompt, ratio, duration, imageBase64 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(PIXELSTER + "/ptv", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
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
    try { data = text ? JSON.parse(text) : {}; } catch {}

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.error || data?.message || "PixelSter HTTP " + response.status);
    }
    if (!data.videoUrl) throw new Error("PixelSter не вернул videoUrl.");
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Motion synthesis не успел ответить за 25 секунд.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "12mb" } }
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
          return res.status(200).json({
            success: true,
            provider: "Hugging Face ZeroGPU",
            model: "LTX-2.3 Fast · 22B · native audio",
            space: fastSpace.base,
            endpoint: "/generate",
            endpoints: Object.keys(info?.named_endpoints || {}),
            free: true,
            audio: true,
            imageToVideo: true,
            duration: "5-10s",
            resolution: "720p"
          });
        } catch (error) {
          return res.status(502).json({
            success: false,
            provider: "Hugging Face ZeroGPU",
            model: "LTX-2.3 Fast · native audio",
            space: fastSpace.base,
            error: errorMessage(error)
          });
        }
      }

      const taskId = String(req.query?.taskId || "").trim();
      if (!taskId) {
        return res.status(400).json({ success: false, error: "Нужен taskId или health=ltx." });
      }

      const task = taskFromId(taskId);
      if (
        (task.v !== 12 && task.v !== 13) ||
        task.provider !== "huggingface" ||
        task.model !== "ltx23fast-audio" && task.model !== "ltx23official-audio" ||
        !task.eventId ||
        !task.callUrl
      ) {
        return res.status(400).json({ success: false, error: "Некорректная задача LTX-2.3." });
      }

      const status = await pollLtxTask(task, 12000);

      if (!status.done) {
        return res.status(200).json({
          success: true,
          done: false,
          status: status.status || "RUNNING",
          provider: "Hugging Face ZeroGPU",
          model: task.model === "ltx23official-audio" ? "LTX-2.3 Official · Audio" : "LTX-2.3 Fast · Audio",
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
          model: task.model === "ltx23official-audio" ? "LTX-2.3 Official · Audio" : "LTX-2.3 Fast · Audio",
          taskId
        });
      }

      const raw = String(req.query?.raw || "") === "1";
      if (raw) {
        if (String(status.videoUrl).startsWith("data:video/")) {
          const comma = status.videoUrl.indexOf(",");
          const mime = status.videoUrl.slice(5, comma).split(";")[0] || "video/mp4";
          const bytes = Buffer.from(status.videoUrl.slice(comma + 1), "base64");
          res.statusCode = 200;
          res.setHeader("Content-Type", mime);
          res.setHeader("Content-Disposition", 'inline; filename="miya-ai-ltx23.mp4"');
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Length", String(bytes.length));
          return res.end(bytes);
        }

        const upstream = await fetch(status.videoUrl, {
          headers: { ...authHeaders(), "User-Agent": "Miya-AI/1.0" }
        });

        if (!upstream.ok || !upstream.body) {
          return res.status(502).json({
            success: false,
            done: true,
            error: "Не удалось получить MP4 от LTX-2.3: HTTP " + upstream.status,
            taskId
          });
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", 'inline; filename="miya-ai-ltx23.mp4"');
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
          try { reader.releaseLock(); } catch {}
        }
        return res.end();
      }

      return res.status(200).json({
        success: true,
        done: true,
        status: "COMPLETED",
        videoUrl: "/api/video?taskId=" + encodeURIComponent(taskId) + "&raw=1",
        provider: "Hugging Face ZeroGPU",
        model: task.model === "ltx23official-audio" ? "LTX-2.3 Official · Audio" : "LTX-2.3 Fast · Audio",
        audioAttached: true,
        taskId
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); }
      catch { return res.status(400).json({ success: false, error: "Некорректный JSON запроса." }); }
    }

    const prompt = String(body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ success: false, error: "Введите сценарий движения." });

    const image = await normalizeImage(body.imageBase64, body.imageUrl);
    const model = String(body.model || "ltx25").trim();

    // During the LTX verification phase, legacy UI model IDs are routed to LTX too.
    // This lets the existing Miya editor test LTX immediately without requiring
    // a frontend deployment just to change the default selector.
    if (model === "ltx25" || model === "ltx23" || model === "wan22" || model === "wan5b" || model === "hunyuan") {
      let task;
      try {
        task = await submitLtx({
          image,
          prompt,
          duration: Number(body.duration) || 5,
          aspect: body.aspect || body.ratio || "9:16"
        });
      } catch (fastError) {
        console.warn("LTX Fast unavailable, trying official LTX-2.3:", errorMessage(fastError));
        task = await submitOfficialLtx({
          space: LTX_SPACES[1],
          image,
          prompt,
          duration: Number(body.duration) || 3,
          aspect: body.aspect || body.ratio || "9:16"
        });
      }

      return res.status(202).json({
        success: true,
        done: false,
        taskId: task.taskId,
        status: "QUEUED",
        provider: "Hugging Face ZeroGPU",
        model: task.model === "ltx23official-audio" ? "LTX-2.3 Official · Audio" : "LTX-2.3 Fast · Audio",
        audioAttached: true,
        endpoint: task.endpoint,
        message: task.model === "ltx23official-audio"
          ? "LTX-2.3 Official: Image → Video + synchronized native audio."
          : "LTX-2.3 Fast: Image → Video + synchronized native audio."
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
          error: errorMessage(error),
          code: "PIXELSTER_TIMEOUT"
        });
      }
    }

    return res.status(400).json({
      success: false,
      error: "Неизвестная модель видео: " + model
    });
  } catch (error) {
    console.error("Miya video API:", error);
    return res.status(502).json({
      success: false,
      error: errorMessage(error),
      code: "VIDEO_PROVIDER_ERROR"
    });
  }
}
