const PIXELSTER = "https://ahm7xmakki.com/api";
const WAN_SPACE = "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
const WAN5B_SPACE = "https://openking-wan2-video-generation.hf.space";
const WAN_INFO = WAN_SPACE + "/gradio_api/info";
const WAN5B_INFO = WAN5B_SPACE + "/gradio_api/info";
const WAN_AGENTS = "https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster/agents.md";

function isUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function urlToDataUrl(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Miya-AI/1.0" } });
  if (!response.ok) throw new Error("Не удалось получить исходное изображение: HTTP " + response.status);
  const mime = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error("Источник не является изображением.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 3_500_000) throw new Error("Изображение слишком большое для видео-теста.");
  return "data:" + mime + ";base64," + bytes.toString("base64");
}

async function normalizeImage(imageBase64, imageUrl) {
  const value = String(imageBase64 || "").trim();
  if (value.startsWith("data:image/")) return value;
  if (isUrl(imageUrl)) return urlToDataUrl(imageUrl);
  throw new Error("Исходное изображение не найдено.");
}

function authHeaders() {
  const token = String(process.env.HF_TOKEN || "").trim();
  return token ? { Authorization: "Bearer " + token } : {};
}

async function hfJson(url, options = {}) {
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

function findGenerateEndpoint(info) {
  const api = info?.named_endpoints || info?.endpoints || {};
  const names = Array.isArray(api)
    ? api.map(x => String(x?.name || x?.api_name || ""))
    : Object.keys(api);
  const exact = names.find(name => /generate_video/i.test(name));
  if (exact) return exact.replace(/^\//, "");
  const loose = names.find(name => /generate.*video|video.*generate/i.test(name));
  if (loose) return loose.replace(/^\//, "");
  throw new Error("Gradio API не сообщил endpoint generate_video.");
}

async function uploadImage(dataUrl, space, label) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Некорректный image data URL.");
  const mime = (dataUrl.slice(5, comma).split(";")[0] || "image/jpeg");
  const ext = mime.includes("png") ? "png" : "jpg";
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");

  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mime }), "miya-video." + ext);

  const response = await fetch(space + "/gradio_api/upload", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(label + " upload HTTP " + response.status + ": " + (text || ""));
  const path = Array.isArray(data) ? data[0] : data?.path;
  if (!path) throw new Error(label + " upload не вернул путь файла.");
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

async function startWanTask({ model, prompt, duration, image }) {
  const space = model === "wan5b" ? WAN5B_SPACE : WAN_SPACE;
  const infoUrl = model === "wan5b" ? WAN5B_INFO : WAN_INFO;
  const info = await hfJson(infoUrl, { headers: { Accept: "application/json" } });
  const endpoint = findGenerateEndpoint(info);
  const imagePath = await uploadImage(image, space, model === "wan5b" ? "Wan 5B" : "Wan 2.2");

  let data;
  if (model === "wan5b") {
    const seconds = Math.min(5, Math.max(3, Number(duration) || 3));
    const frames = Math.min(145, Math.max(73, 1 + Math.round((seconds * 24 - 1) / 24) * 24));
    data = [
      String(prompt || "").trim(),
      { path: imagePath, meta: { _type: "gradio.FileData" }, orig_name: "miya-video.jpg" },
      1280,
      704,
      frames,
      35,
      5,
      -1
    ];
  } else {
    data = [
      { path: imagePath, meta: { _type: "gradio.FileData" }, orig_name: "miya-video.jpg" },
      String(prompt || "").trim(),
      6,
      "blurry, low quality, distorted, static, frozen frame, no motion, deformed, extra limbs",
      Math.min(5, Math.max(1, Number(duration) || 5)),
      1,
      1,
      Math.floor(Math.random() * 2147483647),
      true
    ];
  }

  const response = await fetch(space + "/gradio_api/call/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ data })
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(
      (model === "wan5b" ? "Wan 5B" : "Wan 2.2") +
      " call HTTP " + response.status + ": " + (payload?.error || text || "")
    );
    error.statusCode = response.status;
    throw error;
  }
  if (!payload?.event_id) throw new Error("Gradio не вернул event_id.");

  return {
    taskId: taskIdFor({
      v: 2,
      provider: "huggingface",
      model,
      space,
      endpoint,
      eventId: payload.event_id
    }),
    endpoint,
    eventId: payload.event_id
  };
}

function extractVideoUrl(output) {
  const item = Array.isArray(output) ? output[0] : output;
  const url =
    item?.url ||
    item?.path ||
    item?.video?.url ||
    item?.videoUrl ||
    item?.data?.url ||
    item?.data?.path;
  if (!url) return null;
  return String(url);
}

function makeProviderFileUrl(space, url) {
  if (/^https?:\/\//i.test(url)) return url;
  return space + "/gradio_api/file=" + url.replace(/^\//, "");
}

async function pollWanTask(task, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      task.space + "/gradio_api/call/" + task.endpoint + "/" + encodeURIComponent(task.eventId),
      {
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: controller.signal
      }
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error("Gradio polling HTTP " + response.status + ": " + text.slice(0, 500));
    }

    if (!response.body) return { done: false, status: "RUNNING" };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    let sawError = null;

    const finish = (event, raw) => {
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

      if (event === "error" || event === "unexpected_error") {
        const message =
          typeof data === "string"
            ? data
            : data?.error || data?.message || data?.detail || JSON.stringify(data);
        sawError = "Wan Gradio error: " + message;
        return null;
      }

      if (event === "complete" || event === "process_completed" || event === "data") {
        const url = extractVideoUrl(data);
        if (url && /\.mp4(?:$|\?)/i.test(url)) {
          return {
            done: true,
            success: true,
            videoUrl: makeProviderFileUrl(task.space, url),
            status: "COMPLETED"
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

        const result = finish(currentEvent, raw);
        if (result) {
          try { await reader.cancel(); } catch {}
          return result;
        }
        if (sawError) {
          try { await reader.cancel(); } catch {}
          return { done: true, success: false, status: "ERROR", error: sawError };
        }
      }
    }

    if (sawError) return { done: true, success: false, status: "ERROR", error: sawError };
    return { done: false, success: true, status: "RUNNING" };
  } catch (error) {
    if (error?.name === "AbortError") return { done: false, success: true, status: "RUNNING" };
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
    if (error?.name === "AbortError") {
      throw new Error("Motion synthesis не успел ответить за 25 секунд. Это не ошибка Miya AI — провайдер работает слишком долго.");
    }
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
          const info = await hfJson(WAN_INFO, { headers: { Accept: "application/json" } });
          return res.status(200).json({
            success: true,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V 14B Fast",
            space: WAN_SPACE,
            agents: WAN_AGENTS,
            endpoint: findGenerateEndpoint(info),
            authenticated: Boolean(process.env.HF_TOKEN),
            free: true,
            cloudflare: false
          });
        } catch (error) {
          return res.status(error?.statusCode || 502).json({
            success: false,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V 14B Fast",
            space: WAN_SPACE,
            agents: WAN_AGENTS,
            authenticated: Boolean(process.env.HF_TOKEN),
            error: error?.message || "Wan API недоступен."
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
      if (task.v !== 2 || task.provider !== "huggingface" || !task.eventId || !task.endpoint || !task.space) {
        return res.status(400).json({ success: false, error: "Некорректная задача видео." });
      }

      const status = await pollWanTask(task, 7000);
      if (!status.done) {
        return res.status(200).json({
          success: true,
          done: false,
          status: status.status || "RUNNING",
          provider: "Hugging Face ZeroGPU",
          model: task.model === "wan5b" ? "Wan 2.2 TI2V-5B" : "Wan 2.2 I2V 14B Fast",
          taskId
        });
      }

      if (!status.success || !status.videoUrl) {
        return res.status(200).json({
          success: false,
          done: true,
          status: "ERROR",
          error: status.error || "Провайдер не создал видео.",
          provider: "Hugging Face ZeroGPU",
          model: task.model === "wan5b" ? "Wan 2.2 TI2V-5B" : "Wan 2.2 I2V 14B Fast",
          taskId
        });
      }

      return res.status(200).json({
        success: true,
        done: true,
        status: "COMPLETED",
        videoUrl: status.videoUrl,
        provider: "Hugging Face ZeroGPU",
        model: task.model === "wan5b" ? "Wan 2.2 TI2V-5B" : "Wan 2.2 I2V 14B Fast",
        audioAttached: false,
        audioPending: false,
        endpoint: task.endpoint,
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
    const duration = Math.min(5, Math.max(1, Number(body.duration) || 5));
    const model = String(body.model || "wan22").trim();

    console.log("Miya async video request:", {
      model,
      duration,
      aspect: body.aspect || body.ratio || "9:16",
      promptLength: prompt.length
    });

    if (model === "ltx25") {
      return res.status(501).json({
        success: false,
        error: "LTX 2.5 пока не подключён без HF_TOKEN.",
        code: "LTX25_REQUIRES_HF_ACCESS",
        model: "LTX 2.5 Free"
      });
    }

    if (model === "hunyuan") {
      return res.status(501).json({
        success: false,
        error: "HunyuanVideo пока не подключён к публичному Image→Video маршруту Miya AI.",
        code: "HUNYUAN_ROUTE_UNAVAILABLE",
        model: "HunyuanVideo"
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
          fallbackUsed: false
        });
      } catch (error) {
        return res.status(504).json({
          success: false,
          done: true,
          error: error?.message || "Motion synthesis не успел ответить.",
          code: "PIXELSTER_TIMEOUT",
          provider: "AHM7 PixelSter",
          model: "Motion synthesis",
          fallbackUsed: false
        });
      }
    }

    if (model !== "wan22" && model !== "wan5b") {
      return res.status(400).json({
        success: false,
        error: "Неизвестная модель видео: " + model,
        code: "UNKNOWN_VIDEO_MODEL"
      });
    }

    const task = await startWanTask({
      model,
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
      model: model === "wan5b" ? "Wan 2.2 TI2V-5B" : "Wan 2.2 I2V 14B Fast",
      endpoint: task.endpoint,
      message: "Задача запущена. Miya AI будет проверять её без удержания долгого Vercel-запроса."
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
