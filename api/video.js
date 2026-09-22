import { Client } from "@gradio/client";

const PIXELSTER = "https://ahm7xmakki.com/api";
const WAN_SPACE = "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
const WAN5B_SPACE = "https://openking-wan2-video-generation.hf.space";
const WAN_INFO = WAN_SPACE + "/gradio_api/info";
const WAN_AGENTS = "https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster/agents.md";
const AUDIO_SPACE = "https://stabilityai-stable-audio-3.hf.space";
const AUDIO_API = AUDIO_SPACE + "/gradio_api";

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
    const error = new Error(
      data?.error || data?.message || text || ("HTTP " + response.status)
    );
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function getWanInfo() {
  return hfJson(WAN_INFO, { headers: { Accept: "application/json" } });
}

function findWanEndpoint(info) {
  const candidates = [];
  const api = info?.named_endpoints || info?.endpoints || {};
  for (const [name, value] of Object.entries(api)) {
    const lower = name.toLowerCase();
    if (lower.includes("generate") && lower.includes("video")) candidates.push(name);
  }
  if (!candidates.length && Array.isArray(info?.named_endpoints)) {
    for (const item of info.named_endpoints) {
      const name = String(item?.name || item?.api_name || "");
      if (/generate.*video/i.test(name)) candidates.push(name);
    }
  }
  if (!candidates.length) {
    throw new Error("Wan 2.2 API не сообщил endpoint generate_video. Откройте /api/video?health=wan.");
  }
  return candidates[0].replace(/^\//, "");
}

async function uploadWanImage(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Некорректный image data URL.");
  const mime = (dataUrl.slice(5, comma).split(";")[0] || "image/jpeg");
  const ext = mime.includes("png") ? "png" : "jpg";
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");

  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mime }), "miya-video." + ext);

  const response = await fetch(WAN_SPACE + "/gradio_api/upload", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error("Wan upload HTTP " + response.status + ": " + (text || ""));
  const path = Array.isArray(data) ? data[0] : data?.path;
  if (!path) throw new Error("Wan upload не вернул путь файла.");
  return path;
}

async function callWan(endpoint, imagePath, prompt, duration) {
  const data = [
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

  const response = await fetch(WAN_SPACE + "/gradio_api/call/" + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ data })
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    throw new Error("Wan call HTTP " + response.status + ": " + (payload?.error || text || ""));
  }
  if (!payload?.event_id) throw new Error("Wan API не вернул event_id.");
  return payload.event_id;
}

async function waitWan(endpoint, eventId, timeoutMs = 220000) {
  // Kept as a raw-SSE fallback for compatibility/debugging.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      WAN_SPACE + "/gradio_api/call/" + endpoint + "/" + encodeURIComponent(eventId),
      {
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: controller.signal
      }
    );
    if (!response.ok) throw new Error("Wan polling HTTP " + response.status);

    const text = await response.text();
    let event = "";
    let lastData = null;
    const events = [];

    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        events.push(event);
        continue;
      }
      if (!line.startsWith("data:")) continue;

      const raw = line.slice(5).trim();
      if (!raw || raw === "null") continue;

      let data;
      try { data = JSON.parse(raw); } catch { data = raw; }
      lastData = data;

      if (event === "error" || event === "unexpected_error") {
        const message =
          typeof data === "string"
            ? data
            : data?.error || data?.message || data?.detail || data?.msg ||
              (Array.isArray(data)
                ? data.map(x => x?.error || x?.message || x).join(" | ")
                : JSON.stringify(data));
        const e = new Error("Wan Gradio error: " + message);
        e.code = "WAN_GRADIO_ERROR";
        e.gradioEvent = event;
        e.gradioData = data;
        throw e;
      }

      if (event === "complete" || event === "process_completed") {
        const output = Array.isArray(data) ? data[0] : data;
        const url =
          output?.url || output?.path || output?.video?.url ||
          output?.videoUrl || output?.data?.url || output?.data?.path;
        if (url) return { output, url };
      }

      if (event === "data" || event === "generating" || event === "streaming") {
        const output = Array.isArray(data) ? data[0] : data;
        const url =
          output?.url || output?.path || output?.video?.url ||
          output?.videoUrl || output?.data?.url || output?.data?.path;
        if (url && /\.mp4(?:$|\?)/i.test(String(url))) return { output, url };
      }
    }

    const tail = lastData ? " Последние данные: " + JSON.stringify(lastData).slice(0, 1200) : "";
    throw new Error(
      "Wan завершил HTTP-запрос без финального события. " +
      (events.length ? "События: " + events.join(", ") : "SSE-события не получены") +
      tail
    );
  } finally {
    clearTimeout(timer);
  }
}

async function wan5bVideo({ prompt, duration, image }) {
  const info = await hfJson(WAN5B_SPACE + "/gradio_api/info", { headers: { Accept: "application/json" } });
  const endpoint = findWanEndpoint(info);
  const imagePath = await uploadWan5bImage(image);

  // Wan2.2-TI2V-5B public Space:
  // prompt, image, width, height, frames, steps, guidance, seed
  const seconds = Math.min(5, Math.max(3, Number(duration) || 3));
  const frames = Math.min(145, Math.max(73, 1 + Math.round((seconds * 24 - 1) / 24) * 24));
  const data = [
    String(prompt || "").trim(),
    { path: imagePath, meta: { _type: "gradio.FileData" }, orig_name: "miya-video.jpg" },
    1280,
    704,
    frames,
    35,
    5,
    -1
  ];

  const client = await Client.connect(WAN5B_SPACE, {
    ...(process.env.HF_TOKEN ? { token: process.env.HF_TOKEN } : {}),
    events: ["data", "status"]
  });
  const job = client.submit(endpoint, data);
  const deadline = Date.now() + 210000;
  let lastStatus = null;

  for await (const msg of job) {
    if (Date.now() > deadline) {
      try { job.cancel(); } catch {}
      throw new Error("Wan 2.2 TI2V-5B превысил лимит ожидания 210 секунд.");
    }
    if (msg?.type === "status") {
      lastStatus = msg;
      console.log("Miya Wan 5B status:", JSON.stringify(msg));
      if (msg.stage === "error") {
        throw new Error("Wan 5B Gradio error: " + (msg.message || msg.code || JSON.stringify(msg)));
      }
    }
    if (msg?.type === "data") {
      const output = Array.isArray(msg.data) ? msg.data[0] : msg.data;
      const url = output?.url || output?.path || output?.video?.url || output?.videoUrl || output?.data?.url || output?.data?.path;
      if (url && /\.mp4(?:$|\?)/i.test(String(url))) {
        const sourceUrl = /^https?:\/\//i.test(String(url))
          ? String(url)
          : WAN5B_SPACE + "/gradio_api/file=" + String(url).replace(/^\//, "");
        return { endpoint, sourceUrl, frames, duration: frames / 24, output };
      }
    }
  }
  throw new Error("Wan 2.2 TI2V-5B не вернул готовый MP4. " + (lastStatus?.message || lastStatus?.stage || "пустой ответ Gradio"));
}

async function uploadWan5bImage(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Некорректный image data URL.");
  const mime = (dataUrl.slice(5, comma).split(";")[0] || "image/jpeg");
  const ext = mime.includes("png") ? "png" : "jpg";
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mime }), "miya-video." + ext);
  const response = await fetch(WAN5B_SPACE + "/gradio_api/upload", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error("Wan 5B upload HTTP " + response.status + ": " + (text || ""));
  const path = Array.isArray(data) ? data[0] : data?.path;
  if (!path) throw new Error("Wan 5B upload не вернул путь файла.");
  return path;
}

async function wanVideo({ prompt, duration, image }) {
  const info = await getWanInfo();
  const endpoint = findWanEndpoint(info);
  const imagePath = await uploadWanImage(image);

  const client = await Client.connect(WAN_SPACE, {
    ...(process.env.HF_TOKEN ? { token: process.env.HF_TOKEN } : {}),
    events: ["data", "status"]
  });

  const data = [
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

  const job = client.submit(endpoint, data);
  const deadline = Date.now() + 220000;
  let finalOutput = null;
  let lastStatus = null;

  for await (const msg of job) {
    if (Date.now() > deadline) {
      try { job.cancel(); } catch {}
      throw new Error("Wan 2.2 превысил лимит ожидания 220 секунд.");
    }

    if (msg?.type === "status") {
      lastStatus = msg;
      console.log("Miya Wan status:", JSON.stringify(msg));
      if (msg.stage === "error") {
        throw new Error(
          "Wan Gradio error: " +
          (msg.message || msg.code || JSON.stringify(msg))
        );
      }
    }

    if (msg?.type === "data") {
      finalOutput = msg.data;
      const output = Array.isArray(msg.data) ? msg.data[0] : msg.data;
      const url =
        output?.url || output?.path || output?.video?.url ||
        output?.videoUrl || output?.data?.url || output?.data?.path;

      if (url && /\.mp4(?:$|\?)/i.test(String(url))) {
        const sourceUrl = /^https?:\/\//i.test(String(url))
          ? String(url)
          : WAN_SPACE + "/gradio_api/file=" + String(url).replace(/^\//, "");
        return { endpoint, sourceUrl, output };
      }
    }
  }

  throw new Error(
    "Wan не вернул готовый MP4. " +
    (lastStatus?.message || lastStatus?.stage || "пустой ответ Gradio")
  );
}


async function pixelsterVideo({ prompt, ratio, duration, imageBase64 }) {
  const response = await fetch(PIXELSTER + "/ptv", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      prompt: String(prompt || "").trim(),
      ratio: ratio || "9:16",
      duration: Math.min(20, Math.max(5, Number(duration) || 5)),
      imageBase64
    })
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (response.status === 504) {
    const e = new Error("PixelSter сейчас не успел завершить генерацию видео (HTTP 504).");
    e.code = "UPSTREAM_TIMEOUT"; e.statusCode = 504; throw e;
  }
  if (!response.ok) {
    const e = new Error(data?.error?.message || data?.error || data?.message || "PixelSter HTTP " + response.status);
    e.code = "UPSTREAM_ERROR"; e.statusCode = response.status; throw e;
  }
  if (!data.videoUrl) {
    const e = new Error("PixelSter не вернул videoUrl.");
    e.code = "MISSING_VIDEO_URL"; e.statusCode = 502; throw e;
  }
  return data;
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
      if (String(req.query?.health || "") === "wan") {
        try {
          const info = await getWanInfo();
          return res.status(200).json({
            success: true,
            provider: "Hugging Face ZeroGPU",
            model: "Wan 2.2 I2V 14B Fast",
            space: WAN_SPACE,
            agents: WAN_AGENTS,
            endpoint: findWanEndpoint(info),
            authenticated: Boolean(process.env.HF_TOKEN),
            info
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

      if (String(req.query?.health || "") === "1") {
        return res.status(200).json({
          success: true,
          primary: "Hugging Face ZeroGPU / Wan 2.2 I2V 14B Fast",
          fallback: "AHM7 PixelSter / Motion synthesis",
          free: true,
          cloudflare: false,
          hfTokenConfigured: Boolean(process.env.HF_TOKEN)
        });
      }

      return res.status(400).json({ success: false, error: "Use /api/video?health=1 or /api/video?health=wan" });
    }

    if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          success: false,
          error: "Некорректный JSON запроса.",
          code: "INVALID_JSON"
        });
      }
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({
        success: false,
        error: "Пустое тело запроса.",
        code: "EMPTY_BODY"
      });
    }
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ success: false, error: "Введите сценарий движения." });

    const image = await normalizeImage(body.imageBase64, body.imageUrl);
    const duration = Math.min(5, Math.max(1, Number(body.duration) || 5));
    const model = String(body.model || "pixelster-motion").trim();

    console.log("Miya video request:", {
      model,
      duration,
      aspect: body.aspect || body.ratio || "9:16",
      promptLength: prompt.length,
      imageBytes: image.startsWith("data:") ? Math.floor((image.length * 3) / 4) : 0
    });

    if (model === "ltx25") {
      return res.status(501).json({ success:false, error:"LTX 2.5 выбран, но публичный маршрут требует принятия лицензии Lightricks и HF_TOKEN. Для Miya AI он пока не подключён без токена.", code:"LTX25_REQUIRES_HF_ACCESS", model:"LTX 2.5 Free", provider:"Hugging Face" });
    }
    if (model === "hunyuan") {
      return res.status(501).json({ success:false, error:"HunyuanVideo выбран, но подходящий публичный Image→Video ZeroGPU маршрут сейчас не подключён к Miya AI. Выберите Wan I2V Free или Motion synthesis.", code:"HUNYUAN_ROUTE_UNAVAILABLE", model:"HunyuanVideo", provider:"Hugging Face" });
    }

    if (model === "pixelster-motion") {
      const data = await pixelsterVideo({
        prompt,
        ratio: body.aspect || body.ratio || "9:16",
        duration: Math.max(5, duration),
        imageBase64: image
      });
      return res.status(200).json({ success:true, done:true, videoUrl:data.videoUrl, provider:"AHM7 PixelSter", model:"Motion synthesis", fallbackUsed:false });
    }

    if (model === "wan5b") {
      try {
        const wan = await wan5bVideo({ prompt, duration, image });
        const videoResponse = await fetch(wan.sourceUrl, { headers: authHeaders() });
        if (!videoResponse.ok) throw new Error("Wan 5B MP4 download HTTP " + videoResponse.status);
        const videoBytes = Buffer.from(await videoResponse.arrayBuffer());
        if (videoBytes.length < 10000) throw new Error("Wan 5B вернул слишком маленький MP4: " + videoBytes.length + " bytes");
        return res.status(200).json({
          success:true,
          done:true,
          videoUrl:"data:video/mp4;base64," + videoBytes.toString("base64"),
          videoSourceUrl:wan.sourceUrl,
          provider:"Hugging Face ZeroGPU",
          model:"Wan 2.2 TI2V-5B",
          audioAttached:false,
          endpoint:wan.endpoint,
          frames:wan.frames,
          fps:24,
          promptUsed:prompt,
          fallbackUsed:false
        });
      } catch (wanError) {
        console.error("Miya Wan 2.2 TI2V-5B video failed:", wanError);
        return res.status(502).json({
          success:false,
          done:false,
          error:"Wan 2.2 TI2V-5B не смог создать видео: " + (wanError?.message || "неизвестная ошибка"),
          code:"WAN5B_FAILED",
          provider:"Hugging Face ZeroGPU",
          model:"Wan 2.2 TI2V-5B",
          fallbackUsed:false
        });
      }
    }

    if (model !== "wan22" && model !== "wan5b") {
      return res.status(400).json({ success:false, error:"Неизвестная модель видео: "+model, code:"UNKNOWN_VIDEO_MODEL" });
    }

    try {
      const wan = await wanVideo({ prompt, duration, image });

      const videoResponse = await fetch(wan.sourceUrl, {
        headers: authHeaders()
      });
      if (!videoResponse.ok) {
        throw new Error("Wan MP4 download HTTP " + videoResponse.status);
      }

      const videoBytes = Buffer.from(await videoResponse.arrayBuffer());
      if (videoBytes.length < 10000) {
        throw new Error("Wan вернул слишком маленький MP4: " + videoBytes.length + " bytes");
      }

      return res.status(200).json({
        success: true,
        done: true,
        videoUrl: "data:video/mp4;base64," + videoBytes.toString("base64"),
        videoSourceUrl: wan.sourceUrl,
        provider: "Hugging Face ZeroGPU",
        model: "Wan 2.2 I2V 14B Fast",
        audioAttached: false,
        audioPending: false,
        endpoint: wan.endpoint,
        promptUsed: prompt,
        promptLength: prompt.length,
        videoBytes: videoBytes.length,
        fallbackUsed: false
      });
    } catch (wanError) {
      console.error("Miya Wan 2.2 video failed:", wanError);
      return res.status((Number(wanError?.statusCode) >= 500 ? 502 : (wanError?.statusCode || 502))).json({
        success: false,
        done: false,
        error: "Wan 2.2 не смог создать видео: " + (wanError?.message || "неизвестная ошибка"),
        code: "WAN22_FAILED",
        provider: "Hugging Face ZeroGPU",
        model: "Wan 2.2 I2V 14B Fast",
        promptReceived: Boolean(prompt),
        fallbackUsed: false
      });
    }
  } catch (error) {
    console.error("Miya video API:", error);
    const status = Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500 ? Number(error.statusCode) : 502;
    return res.status(status).json({
      success: false,
      error: error?.message || "Ошибка видео API.",
      code: error?.code || "VIDEO_PROVIDER_ERROR",
      retryable: status === 504
    });
  }
}
