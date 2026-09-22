import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const PIXELSTER = "https://ahm7xmakki.com/api";
const WAN_SPACE = "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
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
            : data?.error ||
              data?.message ||
              data?.detail ||
              data?.msg ||
              (Array.isArray(data) ? data.map(x => x?.error || x?.message || x).join(" | ") : JSON.stringify(data));
        const e = new Error("Wan Gradio error: " + message);
        e.code = "WAN_GRADIO_ERROR";
        e.gradioEvent = event;
        e.gradioData = data;
        throw e;
      }

      // Gradio versions use both "complete" and "process_completed".
      if (event === "complete" || event === "process_completed") {
        const output = Array.isArray(data) ? data[0] : data;
        const url =
          output?.url ||
          output?.path ||
          output?.video?.url ||
          output?.videoUrl ||
          output?.data?.url ||
          output?.data?.path;

        if (url) return { output, url };
      }

      // Some Space/Gradio revisions send the final file in a data event
      // immediately before closing the SSE stream.
      if (event === "data" || event === "generating" || event === "streaming") {
        const output = Array.isArray(data) ? data[0] : data;
        const url =
          output?.url ||
          output?.path ||
          output?.video?.url ||
          output?.videoUrl ||
          output?.data?.url ||
          output?.data?.path;

        if (url && /\.mp4(?:$|\?)/i.test(String(url))) {
          return { output, url };
        }
      }
    }

    const diagnostic = events.length ? "События: " + events.join(", ") : "SSE-события не получены";
    throw new Error("Wan завершил HTTP-запрос без финального события. " + diagnostic + (lastData ? " Последние данные: " + JSON.stringify(lastData).slice(0, 700) : ""));
  } finally {
    clearTimeout(timer);
  }
}
async function wanVideo({ prompt, duration, image }) {
  const info = await getWanInfo();
  const endpoint = findWanEndpoint(info);
  const imagePath = await uploadWanImage(image);
  const eventId = await callWan(endpoint, imagePath, prompt, duration);
  const result = await waitWan(endpoint, eventId);
  if (!result?.url) throw new Error("Wan не вернул URL готового MP4.");
  const sourceUrl = /^https?:\/\//i.test(String(result.url))
    ? String(result.url)
    : WAN_SPACE + "/gradio_api/file=" + String(result.url).replace(/^\//, "");
  return { ...result, endpoint, sourceUrl };
}

function validateWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44) {
    throw new Error("Stable Audio 3 вернул слишком маленький WAV.");
  }
  const riff = bytes.toString("ascii", 0, 4);
  const wave = bytes.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Stable Audio 3 вернул файл, который не является WAV.");
  }
}

async function stableAudio({ prompt, duration }) {
  const { Client } = await import("@gradio/client");
  const audioPrompt =
    "Sound effects only. No music, no speech, no singing. Realistic cinematic environmental sound effects for this exact scene: " +
    String(prompt || "").trim();

  const app = await Client.connect(
    "stabilityai/stable-audio-3",
    process.env.HF_TOKEN ? { token: process.env.HF_TOKEN } : undefined
  );

  const seconds = Math.min(5, Math.max(1, Number(duration) || 5));
  const result = await app.predict("/infer", [
    "small-sfx",
    audioPrompt,
    seconds,
    8,
    1.0,
    "pingpong",
    Math.floor(Math.random() * 2147483647)
  ]);

  const values = Array.isArray(result?.data) ? result.data : [result?.data];
  let rawUrl = null;

  for (const value of values) {
    const candidates = [
      value?.url,
      value?.path,
      value?.audio?.url,
      value?.audio?.path,
      value?.data?.url,
      value?.data?.path
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        rawUrl = candidate.trim();
        break;
      }
    }
    if (rawUrl) break;
  }

  if (!rawUrl) {
    throw new Error(
      "Stable Audio 3 не вернул WAV-файл. Ответ: " +
      JSON.stringify(result?.data || result).slice(0, 1200)
    );
  }

  const audioUrl = /^https?:\\/\\/i.test(rawUrl)
    ? rawUrl
    : AUDIO_SPACE + "/gradio_api/file=" + rawUrl.replace(/^\\//, "");

  const response = await fetch(audioUrl, {
    headers: authHeaders()
  });

  if (!response.ok) {
    throw new Error("Stable Audio 3 WAV HTTP " + response.status);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length < 1000) {
    throw new Error("Stable Audio 3 вернул слишком маленький WAV: " + bytes.length + " bytes");
  }

  return bytes;
}

async function muxVideoAudio(videoBytes, audioBytes) {
  const ffmpegModule = await import("ffmpeg-static");
  const ffmpegPath = ffmpegModule.default || ffmpegModule;
  if (!ffmpegPath) throw new Error("FFmpeg binary не найден в Vercel runtime.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "miya-av-"));
  const videoPath = path.join(dir, "video.mp4");
  const audioPath = path.join(dir, "audio.wav");
  const outputPath = path.join(dir, "final.mp4");
  await fs.writeFile(videoPath, videoBytes);
  await fs.writeFile(audioPath, audioBytes);
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-y", "-i", videoPath, "-i", audioPath,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
      "-shortest", "-movflags", "faststart", outputPath
    ]);
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", code => code === 0 ? resolve() : reject(new Error("FFmpeg mux failed: " + stderr.slice(-1200))));
  });
  const result = await fs.readFile(outputPath);
  await fs.rm(dir, { recursive: true, force: true });
  return result;
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

export const config = {\n  api: {\n    bodyParser: { sizeLimit: "12mb" }\n  }\n};\n\nexport default async function handler(req, res) {
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

    if (model !== "wan22") {
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

      // Generate a real WAV and mux it into the MP4 on the server.
      // This makes the downloaded file contain an actual audio track,
      // instead of relying on a separate <audio> element in the browser.
      const audioBytes = await stableAudio({ prompt, duration });
      const finalBytes = await muxVideoAudio(videoBytes, audioBytes);

      // Keep the response compact enough for Vercel while making the final
      // MP4 self-contained. The generated Wan clips are currently small.
      const videoUrl = "data:video/mp4;base64," + finalBytes.toString("base64");

      return res.status(200).json({
        success: true,
        done: true,
        videoUrl,
        provider: "Hugging Face ZeroGPU",
        model: "Wan 2.2 I2V 14B Fast",
        audioAttached: true,
        audioPending: false,
        endpoint: wan.endpoint,
        promptUsed: prompt,
        promptLength: prompt.length,
        videoBytes: videoBytes.length,
        audioBytes: audioBytes.length,
        finalBytes: finalBytes.length,
        fallbackUsed: false
      });
    } catch (wanError) {
      console.error("Miya Wan 2.2 video failed:", wanError);
      return res.status(wanError?.statusCode || 502).json({
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
    const status = Number(error?.statusCode) >= 400 && Number(error?.statusCode) <= 599 ? Number(error.statusCode) : 502;
    return res.status(status).json({
      success: false,
      error: error?.message || "Ошибка видео API.",
      code: error?.code || "VIDEO_PROVIDER_ERROR",
      retryable: status === 504
    });
  }
}
