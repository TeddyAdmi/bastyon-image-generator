const LIGHTNING_SPACE = "https://saravutw-wan2-2-i2v-lightning-4-8step-custom.hf.space";
const LIGHTNING_API_PREFIX = "/gradio_api";
const LIGHTNING_INFO = LIGHTNING_SPACE + "/gradio_api/info";
const LIGHTNING_API_NAMES = ["/generate_video", "generate_video"];
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

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || text || ("HTTP " + response.status));
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function normalizeImage(imageBase64, imageUrl) {
  const value = String(imageBase64 || "").trim();
  if (value.startsWith("data:image/")) return value;
  if (isUrl(imageUrl)) {
    const response = await fetch(imageUrl, { headers: { "User-Agent": "Miya-AI/1.0" } });
    if (!response.ok) throw new Error("Не удалось получить исходное изображение: HTTP " + response.status);
    const mime = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!mime.startsWith("image/")) throw new Error("Источник не является изображением.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4_000_000) throw new Error("Изображение слишком большое для видео.");
    return "data:" + mime + ";base64," + bytes.toString("base64");
  }
  throw new Error("Исходное изображение не найдено.");
}

async function uploadImage(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Некорректный image data URL.");
  const mime = (dataUrl.slice(5, comma).split(";")[0] || "image/jpeg");
  const ext = mime.includes("png") ? "png" : "jpg";
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");

  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mime }), "miya-video." + ext);

  const response = await fetch(LIGHTNING_SPACE + "/gradio_api/upload", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error("Wan Lightning upload HTTP " + response.status + ": " + text.slice(0, 500));
  const path = Array.isArray(data) ? data[0] : data?.path;
  if (!path) throw new Error("Wan Lightning upload не вернул путь файла.");
  return path;
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

function findGenerateEndpoint(info) {
  const api = info?.named_endpoints || info?.endpoints || {};
  const names = Array.isArray(api)
    ? api.map(x => String(x?.name || x?.api_name || ""))
    : Object.keys(api);
  const exact = names.find(name => /generate_video/i.test(name));
  if (exact) return exact.replace(/^\//, "");
  const loose = names.find(name => /generate.*video|video.*generate/i.test(name));
  if (loose) return loose.replace(/^\//, "");
  throw new Error("Wan Lightning API не сообщил endpoint generate_video.");
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
  return LIGHTNING_SPACE + "/gradio_api/file=" + String(url).replace(/^\//, "");
}

function extractVideoUrl(output) {
  const values = Array.isArray(output) ? output : [output];
  for (const item of values) {
    if (!item) continue;
    if (typeof item === "string" && /\.mp4(?:$|\?)/i.test(item)) return item;
    const candidate =
      item?.url ||
      item?.path ||
      item?.video?.url ||
      item?.video?.path ||
      item?.videoUrl ||
      item?.data?.url ||
      item?.data?.path;
    if (candidate && /\.mp4(?:$|\?)/i.test(String(candidate))) return String(candidate);
  }
  return null;
}

async function startLightningTask({ prompt, duration, image }) {
  const info = await jsonFetch(LIGHTNING_INFO, { headers: { Accept: "application/json" } });
  const endpoint = findGenerateEndpoint(info);
  const imagePath = await uploadImage(image);

  const seconds = Math.min(5, Math.max(3, Number(duration) || 3));
  const wanPrompt = buildWanPrompt(prompt);

  // Current public Lightning Space input order:
  // image, last_image, prompt, steps, negative, duration,
  // guidance1, guidance2, seed, randomize, quality, scheduler,
  // flow_shift, fps/flow-multiplier, safe-mode, display-result.
  const data = [
    { path: imagePath, meta: { _type: "gradio.FileData" }, orig_name: "miya-video.jpg" },
    null,
    wanPrompt,
    4,
    "static, frozen, blurry, low quality, distorted, deformed, extra limbs, identity change, scene change, camera teleportation, text, watermark",
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

  // ZeroGPU Spaces can report the web page as available while the Gradio
  // worker/API is still waking up. Give it time and retry the POST itself.
  // This also avoids treating a transient 404 as a permanently missing endpoint.
  let payload = null;
  let last404 = "";
  const endpointNames = Array.from(new Set([
    String(endpoint || "").replace(/^\//, ""),
    "generate_video"
  ].filter(Boolean)));

  for (let attempt = 0; attempt < 6 && !payload?.event_id; attempt++) {
    try {
      await fetch(LIGHTNING_SPACE + "/", {
        method: "GET",
        headers: authHeaders(),
        signal: AbortSignal.timeout(10000)
      });
    } catch {}

    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(12000, 2500 * attempt)));
    }

    for (const apiName of endpointNames) {
      const response = await fetch(
        LIGHTNING_SPACE + "/gradio_api/call/" + apiName,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ data }),
          signal: AbortSignal.timeout(30000)
        }
      );

      const text = await response.text();
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }

      if (response.ok && payload?.event_id) break;

      if (response.status === 404) {
        last404 = text || "404 Not Found";
        continue;
      }

      const error = new Error(
        "Wan Lightning call HTTP " + response.status + ": " + (payload?.error || text || "")
      );
      error.statusCode = response.status;
      throw error;
    }
  }

  if (!payload?.event_id) {
    const error = new Error(
      "Wan Lightning: Gradio API не проснулся после 6 попыток. Последний ответ: " +
      String(last404).slice(0, 400)
    );
    error.statusCode = 503;
    throw error;
  }

  return {
    taskId: taskIdFor({
      v: 3,
      provider: "huggingface",
      model: "wan22-lightning",
      space: LIGHTNING_SPACE,
      endpoint,
      eventId: payload.event_id,
      prompt: wanPrompt,
      duration: seconds
    }),
    endpoint,
    eventId: payload.event_id
  };
}

async function pollLightningTask(task, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      task.space + "/gradio_api/call/" + String(task.endpoint).replace(/^\//, "") + "/" + encodeURIComponent(task.eventId),
      {
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404) {
        return { done: false, status: "QUEUED", transientError: "Gradio ещё не открыл event stream." };
      }
      throw new Error("Wan Lightning polling HTTP " + response.status + ": " + text.slice(0, 500));
    }

    if (!response.body) return { done: false, status: "RUNNING" };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    const parseEvent = (event, raw) => {
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

      if (event === "error" || event === "unexpected_error") {
        const message = typeof data === "string"
          ? data
          : data?.error || data?.message || data?.detail || JSON.stringify(data || {});
        return { done: true, success: false, status: "ERROR", error: "Wan Lightning: " + message };
      }

      if (event === "complete" || event === "process_completed" || event === "data") {
        const url = extractVideoUrl(data);
        if (url) {
          return {
            done: true,
            success: true,
            status: "COMPLETED",
            videoUrl: providerFileUrl(url)
          };
        }
      }
      return null;
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        let raw = "";
        for (const line of chunk.split(/\r?\n/)) {
          if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
          else if (line.startsWith("data:")) raw += line.slice(5).trim();
        }

        const result = parseEvent(currentEvent, raw);
        if (result) {
          try { await reader.cancel(); } catch {}
          return result;
        }
      }
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
    if (response.status === 504) throw new Error("Motion synthesis сейчас занят и не успел ответить за 25 секунд.");
    if (!response.ok) throw new Error(data?.error?.message || data?.error || data?.message || "PixelSter HTTP " + response.status);
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
  api: {
    bodyParser: { sizeLimit: "12mb" }
  }
};

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const health = String(req.query?.health || "");
      if (health === "wan" || health === "1") {
        try {
          const info = await jsonFetch(LIGHTNING_INFO, { headers: { Accept: "application/json" } });
          return res.status(200).json({
            success: true,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Lightning · 4 steps",
            space: LIGHTNING_SPACE,
            endpoint: findGenerateEndpoint(info),
            authenticated: Boolean(process.env.HF_TOKEN),
            free: true,
            cloudflare: false
          });
        } catch (error) {
          return res.status(error?.statusCode || 502).json({
            success: false,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Lightning · 4 steps",
            space: LIGHTNING_SPACE,
            authenticated: Boolean(process.env.HF_TOKEN),
            error: error?.message || "Wan Lightning API недоступен."
          });
        }
      }

      const taskId = String(req.query?.taskId || "").trim();
      if (!taskId) return res.status(400).json({ success: false, error: "Нужен taskId или health=1." });

      const task = taskFromId(taskId);

      // Never expose the Hugging Face /tmp MP4 URL directly to the browser.
      // Public Gradio file URLs can fail with NS_ERROR_DOM_NETWORK_ERR.
      // Proxy the finished MP4 through our own Vercel endpoint instead.
      const raw = String(req.query?.raw || "") === "1";
      if (raw) {
        if (task.v !== 3 || task.provider !== "huggingface" || !task.eventId || !task.endpoint || !task.space) {
          return res.status(400).json({ success: false, error: "Некорректная задача видео." });
        }

        const status = await pollLightningTask(task, 12000);
        if (!status.done) {
          return res.status(202).json({
            success: true,
            done: false,
            status: status.status || "RUNNING",
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V Lightning · 4 steps",
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
          headers: { ...authHeaders(), "User-Agent": "Miya-AI/1.0" }
        });
        if (!upstream.ok || !upstream.body) {
          return res.status(502).json({
            success: false,
            done: true,
            error: "Не удалось получить MP4 от Hugging Face: HTTP " + upstream.status,
            taskId
          });
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", 'inline; filename="miya-ai-video.mp4"');
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
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
      if (task.v !== 3 || task.provider !== "huggingface" || !task.eventId || !task.endpoint || !task.space) {
        return res.status(400).json({ success: false, error: "Некорректная задача видео." });
      }

      // IMPORTANT: this request is deliberately short. The browser waits for
      // it to finish before making the next one, so there is never more than
      // one active SSE connection for the same Gradio event_id.
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
          error: status.error || "Wan Lightning завершил задачу без готового MP4.",
          provider: "Hugging Face ZeroGPU",
          model: "Wan 2.2 I2V Lightning · 4 steps",
          taskId
        });
      }

      return res.status(200).json({
        success: true,
        done: true,
        status: "COMPLETED",
        videoUrl: "/api/video?taskId=" + encodeURIComponent(taskId) + "&raw=1",
        provider: "Hugging Face ZeroGPU",
        model: "Wan 2.2 I2V Lightning · 4 steps",
        audioAttached: false,
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
    const duration = Math.min(5, Math.max(3, Number(body.duration) || 3));
    const model = String(body.model || "wan22").trim();

    if (model === "ltx25" || model === "hunyuan" || model === "wan5b") {
      return res.status(501).json({
        success: false,
        error: "Сейчас для быстрого видео используется только Wan 2.2 I2V Lightning. Другие GPU-маршруты временно отключены.",
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
          error: error?.message || "Motion synthesis не успел ответить.",
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

    const task = await startLightningTask({ prompt, duration, image });

    return res.status(202).json({
      success: true,
      done: false,
      taskId: task.taskId,
      status: "QUEUED",
      provider: "Hugging Face ZeroGPU",
      model: "Wan 2.2 I2V Lightning · 4 steps",
      endpoint: task.endpoint,
      message: "Быстрый режим: 4 шага, 3–5 секунд, 16 fps. Публичный ZeroGPU всё равно может иметь очередь."
    });
  } catch (error) {
    console.error("Miya video API:", error);
    const status = Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500
      ? Number(error.statusCode)
      : 502;
    return res.status(status).json({
      success: false,
      error: error?.message || "Ошибка видео API.",
      code: error?.code || "VIDEO_PROVIDER_ERROR"
    });
  }
}
