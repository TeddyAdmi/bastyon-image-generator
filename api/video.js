import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { put } from "@vercel/blob";

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
      8,
      "blurry, low quality, distorted, static, frozen frame, no motion, deformed, extra limbs, identity change, subject change, scene change, camera teleportation",
      Math.min(5, Math.max(1, Number(duration) || 5)),
      1.5,
      2,
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
      eventId: payload.event_id,
      prompt: String(prompt || "").trim(),
      duration: Math.min(5, Math.max(1, Number(duration) || 5))
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

async function pollWanTask(task, timeoutMs = 240000) {
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
            : data?.error || data?.message || data?.detail ||
              (data == null ? "" : JSON.stringify(data));
        if (message) sawError = "Wan Gradio error: " + message;
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


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeWavHeader(dataLength, sampleRate = 44100, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bits / 8;
  const blockAlign = channels * bits / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function addTone(samples, sampleRate, start, duration, frequency, volume, type = "sine") {
  const from = Math.max(0, Math.floor(start * sampleRate));
  const to = Math.min(samples.length, Math.floor((start + duration) * sampleRate));
  for (let i = from; i < to; i++) {
    const t = (i - from) / sampleRate;
    const x = t / Math.max(duration, 0.001);
    const envelope = Math.pow(Math.max(0, 1 - x), 1.8);
    let wave = Math.sin(2 * Math.PI * frequency * t);
    if (type === "triangle") wave = 2 * Math.abs(2 * ((frequency * t) % 1) - 1) - 1;
    samples[i] += wave * volume * envelope;
  }
}

function addNoise(samples, sampleRate, start, duration, volume, color = "white") {
  const from = Math.max(0, Math.floor(start * sampleRate));
  const to = Math.min(samples.length, Math.floor((start + duration) * sampleRate));
  let last = 0;
  for (let i = from; i < to; i++) {
    const t = (i - from) / sampleRate;
    const x = t / Math.max(duration, 0.001);
    const envelope = Math.pow(Math.max(0, 1 - x), 2);
    let n = Math.random() * 2 - 1;
    if (color === "brown") {
      last = last * 0.985 + n * 0.015;
      n = last * 4;
    }
    samples[i] += n * volume * envelope;
  }
}

function addWhoosh(samples, sampleRate, start, duration) {
  const from = Math.max(0, Math.floor(start * sampleRate));
  const to = Math.min(samples.length, Math.floor((start + duration) * sampleRate));
  for (let i = from; i < to; i++) {
    const t = (i - from) / sampleRate;
    const x = t / Math.max(duration, 0.001);
    const envelope = Math.sin(Math.PI * x) * 0.16;
    const freq = 180 + 900 * x;
    samples[i] += Math.sin(2 * Math.PI * freq * t) * envelope;
  }
  addNoise(samples, sampleRate, start, duration, 0.10, "white");
}

function addImpact(samples, sampleRate, start) {
  addTone(samples, sampleRate, start, 0.34, 78, 0.52);
  addTone(samples, sampleRate, start, 0.18, 145, 0.25);
  addNoise(samples, sampleRate, start, 0.16, 0.28, "brown");
}

function addMetal(samples, sampleRate, start) {
  addTone(samples, sampleRate, start, 0.75, 620, 0.28);
  addTone(samples, sampleRate, start, 0.55, 1040, 0.20);
  addTone(samples, sampleRate, start, 0.40, 1510, 0.14);
  addNoise(samples, sampleRate, start, 0.10, 0.16, "white");
}

function addFootsteps(samples, sampleRate, start, duration) {
  const count = Math.max(2, Math.min(8, Math.round(duration * 2)));
  const gap = Math.max(0.22, duration / count);
  for (let i = 0; i < count; i++) {
    const t = start + i * gap;
    addTone(samples, sampleRate, t, 0.08, 72, 0.30);
    addNoise(samples, sampleRate, t, 0.055, 0.08, "brown");
  }
}

function addWater(samples, sampleRate, start, duration) {
  addNoise(samples, sampleRate, start, duration, 0.10, "white");
  addTone(samples, sampleRate, start, duration, 420, 0.035);
  addTone(samples, sampleRate, start + 0.18, duration - 0.18, 680, 0.025);
}

function addFire(samples, sampleRate, start, duration) {
  addNoise(samples, sampleRate, start, duration, 0.08, "brown");
  const count = Math.max(4, Math.floor(duration * 5));
  for (let i = 0; i < count; i++) {
    const t = start + Math.random() * duration;
    addNoise(samples, sampleRate, t, 0.025, 0.20, "white");
  }
}

function addGlass(samples, sampleRate, start) {
  addTone(samples, sampleRate, start, 0.60, 1850, 0.20);
  addTone(samples, sampleRate, start, 0.48, 2670, 0.14);
  addTone(samples, sampleRate, start + 0.03, 0.32, 3400, 0.10);
}

function addDoor(samples, sampleRate, start) {
  addTone(samples, sampleRate, start, 0.30, 62, 0.40);
  addNoise(samples, sampleRate, start, 0.10, 0.10, "brown");
}

function createAutomaticSfxWav(prompt, duration) {
  const sampleRate = 44100;
  const seconds = clamp(Number(duration) || 5, 1, 5);
  const samples = new Float32Array(Math.ceil(seconds * sampleRate));
  const text = String(prompt || "").toLowerCase();

  const events = [];
  const addEvent = (time, fn, label) => {
    if (time < seconds) events.push({ time, fn, label });
  };

  const movement = /беж|бег|ид[её]|ходит|движ|прыж|прыг|падает|падени|скольз|машет|летит|летя|вращ|камера|двига|runs?|walk|walking|run|running|jump|jumping|fall|falls|slide|slips?|moves?|moving|flies|flying|camera|whip|pan|zoom/i.test(text);
  const footsteps = /шаг|ид[её]т|идут|ходит|беж|бег|footstep|walking|walk|running|runs?/i.test(text);
  const impact = /удар|стук|врез|падает|падени|толка|огр[её]л|ударил|crash|hit|impact|slam|punch|kick|fall|falls|collid/i.test(text);
  const metal = /кастрюл|сковород|металл|желез|банка|metal|pan|pot|clang/i.test(text);
  const water = /вода|вод[еыу]|море|океан|дожд|бассейн|water|ocean|sea|rain|splash/i.test(text);
  const fire = /огонь|пламя|кост[её]р|горит|fire|flame|burn|explos/i.test(text);
  const glass = /стекл|бутыл|glass|bottle|shatter/i.test(text);
  const door = /двер|door|закрыва|открыва/i.test(text);
  const quiet = /без звука|без звуков|тишин|silent|no sound|mute/i.test(text);

  if (quiet) return Buffer.concat([makeWavHeader(0, sampleRate), Buffer.alloc(0)]);

  if (footsteps) addEvent(Math.min(0.25, seconds * 0.08), (s) => addFootsteps(s, sampleRate, Math.min(0.25, seconds * 0.08), Math.max(0.7, seconds * 0.55)), "footsteps");
  if (movement && !footsteps) addEvent(Math.min(0.55, seconds * 0.12), (s) => addWhoosh(s, sampleRate, Math.min(0.55, seconds * 0.12), 0.55), "movement");
  if (impact) addEvent(Math.max(0.7, seconds * 0.58), (s) => addImpact(s, sampleRate, Math.max(0.7, seconds * 0.58)), "impact");
  if (metal) addEvent(Math.min(seconds - 0.1, Math.max(1.0, seconds * 0.68)), (s) => addMetal(s, sampleRate, Math.min(seconds - 0.1, Math.max(1.0, seconds * 0.68))), "metal");
  if (water) addEvent(Math.min(0.2, seconds * 0.05), (s) => addWater(s, sampleRate, 0.08, Math.max(0.4, seconds - 0.08)), "water");
  if (fire) addEvent(0.08, (s) => addFire(s, sampleRate, 0.08, seconds - 0.08), "fire");
  if (glass) addEvent(Math.max(0.5, seconds * 0.62), (s) => addGlass(s, sampleRate, Math.max(0.5, seconds * 0.62)), "glass");
  if (door) addEvent(Math.max(0.4, seconds * 0.48), (s) => addDoor(s, sampleRate, Math.max(0.4, seconds * 0.48)), "door");

  if (!events.length) {
    addEvent(Math.min(0.6, seconds * 0.12), (s) => addWhoosh(s, sampleRate, Math.min(0.6, seconds * 0.12), 0.50), "generic movement");
    addEvent(Math.max(1.0, seconds * 0.65), (s) => addImpact(s, sampleRate, Math.max(1.0, seconds * 0.65)), "generic action");
  }

  for (const event of events) event.fn(samples);

  for (let i = 0; i < samples.length; i++) {
    samples[i] = clamp(samples[i], -0.92, 0.92);
  }

  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    pcm.writeInt16LE(Math.round(samples[i] * 32767), i * 2);
  }

  return Buffer.concat([makeWavHeader(pcm.length, sampleRate), pcm]);
}

async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("FFmpeg binary не найден после установки ffmpeg-static."));
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error("FFmpeg завершился с кодом " + code + ": " + stderr.slice(-1200)));
    });
  });
}

async function attachAutomaticSfx(videoUrl, prompt, duration) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      videoUrl,
      audioAttached: false,
      audioPending: false,
      audioError: "Для финального MP4 со звуком нужен Vercel Blob: BLOB_READ_WRITE_TOKEN не настроен."
    };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "miya-video-"));
  const input = path.join(dir, "input.mp4");
  const audio = path.join(dir, "sfx.wav");
  const output = path.join(dir, "output.mp4");

  try {
    const response = await fetch(videoUrl, { headers: authHeaders() });
    if (!response.ok) throw new Error("Не удалось скачать готовое видео для FFmpeg: HTTP " + response.status);
    const videoBytes = Buffer.from(await response.arrayBuffer());
    if (videoBytes.length < 1000) throw new Error("Wan вернул пустой или повреждённый MP4.");
    await fs.writeFile(input, videoBytes);
    await fs.writeFile(audio, createAutomaticSfxWav(prompt, duration));

    await runFfmpeg([
      "-y",
      "-i", input,
      "-i", audio,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "2",
      "-shortest",
      "-movflags", "+faststart",
      output
    ]);

    const bytes = await fs.readFile(output);
    const blob = await put(
      "miya/videos/" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".mp4",
      bytes,
      {
        access: "public",
        contentType: "video/mp4",
        addRandomSuffix: false,
        multipart: true
      }
    );

    return {
      videoUrl: blob.url,
      audioAttached: true,
      audioPending: false,
      audioProvider: "Miya automatic SFX",
      audioTracks: "synthetic sound effects"
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
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

      const status = await pollWanTask(task, 240000);
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
          error: status.error || "Wan Gradio завершил задачу без готового MP4. Возможно, ZeroGPU остановил задачу или очередь была прервана.",
          provider: "Hugging Face ZeroGPU",
          model: task.model === "wan5b" ? "Wan 2.2 TI2V-5B" : "Wan 2.2 I2V 14B Fast",
          taskId
        });
      }

      let finalVideo = {
        videoUrl: status.videoUrl,
        audioAttached: false,
        audioPending: true
      };
      try {
        finalVideo = await attachAutomaticSfx(
          status.videoUrl,
          task.prompt || "",
          task.duration || 5
        );
      } catch (audioError) {
        console.error("Miya SFX/FFmpeg:", audioError);
        return res.status(502).json({
          success: false,
          done: true,
          status: "ERROR",
          error: audioError?.message || "Не удалось скачать/обработать видео Wan.",
          code: "VIDEO_FINALIZE_FAILED",
          provider: "Hugging Face ZeroGPU",
          model: task.model === "wan5b" ? "Wan 2.2 TI2V-5B" : "Wan 2.2 I2V 14B Fast",
          taskId
        });
      }

      return res.status(200).json({
        success: true,
        done: true,
        status: "COMPLETED",
        videoUrl: finalVideo.videoUrl,
        provider: "Hugging Face ZeroGPU",
        model: task.model === "wan5b" ? "Wan 2.2 TI2V-5B" : "Wan 2.2 I2V 14B Fast",
        audioAttached: Boolean(finalVideo.audioAttached),
        audioPending: Boolean(finalVideo.audioPending),
        audioProvider: finalVideo.audioProvider || "Miya automatic SFX",
        audioTracks: finalVideo.audioTracks || null,
        audioError: finalVideo.audioError || null,
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
