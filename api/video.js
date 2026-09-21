function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

function parseDataUrl(value) {
  const m = String(value || "").match(/^data:(image\\/[^;]+);base64,(.+)$/s);
  if (!m) throw new Error("Изображение должно быть data:image/...;base64,...");
  return {
    mime: m[1].toLowerCase(),
    base64: m[2].replace(/\\s/g, "")
  };
}

async function urlToDataUrl(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Miya-AI/1.0" } });
  if (!r.ok) throw new Error("Не удалось получить изображение: HTTP " + r.status);
  const type = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!type.startsWith("image/")) throw new Error("URL не вернул изображение.");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 10_000_000) throw new Error("Изображение слишком большое.");
  return "data:" + type + ";base64," + buf.toString("base64");
}

async function normalizeImage(imageBase64, imageUrl) {
  if (String(imageBase64 || "").startsWith("data:image/")) return imageBase64;
  if (isHttpUrl(imageUrl)) return await urlToDataUrl(imageUrl);
  throw new Error("Исходное изображение не найдено.");
}

function ltxBase() {
  return String(process.env.LTX_SERVER_URL || "").replace(/\\/$/, "");
}

async function ltx(path, options = {}) {
  const base = ltxBase();
  if (!base) {
    throw new Error("LTX_SERVER_URL не настроен. Подключите публичный LTX GPU сервер.");
  }

  const r = await fetch(base + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await r.text();
  let d = {};
  try { d = text ? JSON.parse(text) : {}; }
  catch { throw new Error("LTX GPU сервер вернул не JSON (HTTP " + r.status + ")."); }
  if (!r.ok) throw new Error(d.error || d.message || ("LTX HTTP " + r.status));
  return d;
}

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { throw new Error("Некорректный JSON."); }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET" && String(req.query?.health || "") === "1") {
      return res.status(200).json({
        success: true,
        ltxConfigured: Boolean(ltxBase()),
        provider: "LTX-Video GPU",
        message: ltxBase() ? "LTX_SERVER_URL configured" : "LTX_SERVER_URL is missing"
      });
    }

    if (req.method === "GET") {
      const taskId = String(req.query?.taskId || "");
      if (!taskId.startsWith("ltx:")) {
        return res.status(400).json({
          success: false,
          error: "Неизвестная задача. Используется только LTX GPU."
        });
      }

      const jobId = taskId.slice(4);
      const d = await ltx("/jobs/" + encodeURIComponent(jobId));

      if (d.done && d.success && d.videoUrl) {
        return res.status(200).json({
          success: true,
          done: true,
          status: "SUCCEEDED",
          videoUrl: d.videoUrl,
          provider: "LTX-Video GPU",
          model: d.model || "ltxv-2b-0.9.8-distilled"
        });
      }

      if (d.done && !d.success) {
        return res.status(200).json({
          success: false,
          done: true,
          status: "FAILED",
          error: d.error || "LTX не смог создать видео."
        });
      }

      return res.status(200).json({
        success: true,
        done: false,
        status: d.status || "RUNNING",
        provider: "LTX-Video GPU",
        model: d.model || "ltxv-2b-0.9.8-distilled"
      });
    }

    if (req.method !== "POST") return res.status(405).json({success:false,error:"Method not allowed"});

    const b = bodyOf(req);
    const prompt = String(b.prompt || "").trim();
    if (!prompt) return res.status(400).json({success:false,error:"Введите описание движения."});

    if (!ltxBase()) {
      return res.status(503).json({
        success: false,
        code: "LTX_NOT_CONFIGURED",
        error: "Видео сейчас не подключено: в Vercel не задан LTX_SERVER_URL."
      });
    }

    const image = await normalizeImage(b.imageBase64, b.imageUrl);
    const d = await ltx("/generate", {
      method: "POST",
      body: JSON.stringify({ imageBase64: image, prompt, seed: b.seed ?? null })
    });

    if (!d.jobId) throw new Error("LTX не вернул jobId.");

    return res.status(202).json({
      success: true,
      done: false,
      taskId: "ltx:" + d.jobId,
      status: d.status || "queued",
      provider: "LTX-Video GPU",
      model: d.model || "ltxv-2b-0.9.8-distilled",
      duration: d.duration || 5
    });
  } catch (e) {
    console.error("Miya video API:", e);
    return res.status(500).json({
      success: false,
      error: e?.message || "Ошибка видеогенерации."
    });
  }
}
