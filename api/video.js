function isUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function urlToDataUrl(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Miya-AI/1.0" } });
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!r.ok) throw new Error("Не удалось получить исходное изображение: HTTP " + r.status);
  const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error("Источник не является изображением.");
  if (bytes.length > 10_000_000) throw new Error("Изображение слишком большое.");
  return "data:" + mime + ";base64," + bytes.toString("base64");
}

async function normalizeImage(imageBase64, imageUrl) {
  const value = String(imageBase64 || "").trim();
  if (value.startsWith("data:image/")) return value;
  if (isUrl(imageUrl)) return await urlToDataUrl(imageUrl);
  throw new Error("Исходное изображение не найдено.");
}

function ltxBase() {
  return String(process.env.LTX_SERVER_URL || "").replace(/\/$/, "");
}

async function ltx(path, options = {}) {
  const base = ltxBase();
  if (!base) throw new Error("LTX_SERVER_URL не настроен в Vercel.");

  const r = await fetch(base + path, {
    ...options,
    headers: { ...(options.headers || {}) }
  });

  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error("LTX GPU сервер вернул не JSON (HTTP " + r.status + ")."); }

  if (!r.ok) throw new Error(data?.error || data?.message || ("LTX HTTP " + r.status));
  return data;
}

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); }
    catch { throw new Error("Некорректный JSON."); }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET" && String(req.query?.health || "") === "1") {
      if (!ltxBase()) {
        return res.status(200).json({
          success: true,
          ltxConfigured: false,
          reachable: false,
          provider: "LTX-Video GPU",
          message: "LTX_SERVER_URL отсутствует"
        });
      }

      try {
        const h = await ltx("/health", { method: "GET" });
        return res.status(200).json({
          success: true,
          ltxConfigured: true,
          reachable: true,
          provider: "LTX-Video GPU",
          model: h.model || "ltxv-2b-0.9.8-distilled"
        });
      } catch (e) {
        return res.status(200).json({
          success: true,
          ltxConfigured: true,
          reachable: false,
          provider: "LTX-Video GPU",
          message: e?.message || "LTX недоступен"
        });
      }
    }

    if (req.method === "GET") {
      const taskId = String(req.query?.taskId || "");
      if (!taskId.startsWith("ltx:")) {
        return res.status(400).json({ success: false, error: "Неизвестная задача." });
      }

      const d = await ltx("/jobs/" + encodeURIComponent(taskId.slice(4)), { method: "GET" });

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

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const b = bodyOf(req);
    const prompt = String(b.prompt || "").trim();

    if (!prompt) return res.status(400).json({ success: false, error: "Введите описание движения." });
    if (!ltxBase()) {
      return res.status(503).json({
        success: false,
        code: "LTX_NOT_CONFIGURED",
        error: "Видео не подключено: добавьте LTX_SERVER_URL в Vercel."
      });
    }

    const image = await normalizeImage(b.imageBase64, b.imageUrl);

    const d = await ltx("/generate", {
      method: "POST",
      body: JSON.stringify({
        imageBase64: image,
        prompt,
        seed: b.seed == null ? null : Number(b.seed)
      })
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
  } catch (error) {
    console.error("Miya video API:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Ошибка видеогенерации."
    });
  }
}
