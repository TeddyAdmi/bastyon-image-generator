function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

async function responseJsonOrError(response, provider) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {
    throw new Error(provider + " вернул не JSON (HTTP " + response.status + ").");
  }
  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error ||
      data?.message ||
      provider + " HTTP " + response.status
    );
  }
  return data;
}

async function urlToDataUrl(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Miya-AI/1.0" } });
  if (!r.ok) throw new Error("Не удалось загрузить исходное изображение (HTTP " + r.status + ").");
  const type = (r.headers.get("content-type") || "").split(";")[0];
  if (!type.startsWith("image/")) throw new Error("URL исходного файла не является изображением.");
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > 3_500_000) throw new Error("Изображение больше лимита 3.5 MB.");
  return "data:" + type + ";base64," + b.toString("base64");
}

async function normalizeImage(imageBase64, imageUrl) {
  const b64 = String(imageBase64 || "").trim();
  if (b64.startsWith("data:image/")) return b64;
  const url = String(imageUrl || "").trim();
  if (isHttpUrl(url)) return urlToDataUrl(url);
  throw new Error("Исходное изображение не найдено.");
}

async function pixelsterVideo({ prompt, ratio, duration, imageBase64 }) {
  const r = await fetch("https://ahm7xmakki.com/api/ptv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      ratio: ratio || "16:9",
      duration: [5, 10, 15, 20].includes(Number(duration)) ? Number(duration) : 5,
      imageBase64
    })
  });

  const data = await responseJsonOrError(r, "PixelSter видео");

  if (!data?.videoUrl) {
    throw new Error("PixelSter видео не вернул videoUrl.");
  }

  return {
    success: true,
    done: true,
    status: "SUCCEEDED",
    videoUrl: data.videoUrl,
    provider: "PixelSter",
    model: "Motion Synthesis",
    duration: data.duration || duration || 6
  };
}

function getLtxBaseUrl() {
  return String(process.env.LTX_SERVER_URL || "").replace(/\/$/, "");
}

async function ltxRequest(path, options = {}) {
  const base = getLtxBaseUrl();
  if (!base) throw new Error("LTX_SERVER_URL не настроен.");
  const r = await fetch(base + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {
    throw new Error("LTX GPU сервер вернул не JSON (HTTP " + r.status + ").");
  }
  if (!r.ok) throw new Error(data?.error || data?.message || "Ошибка LTX GPU сервера.");
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const taskId = String(req.query?.taskId || "");
      if (!taskId) return res.status(400).json({ success:false, error:"Не указан taskId." });

      if (taskId.startsWith("ltx:")) {
        const data = await ltxRequest("/jobs/" + encodeURIComponent(taskId.slice(4)));
        if (data.done && data.success && data.videoUrl) {
          return res.status(200).json({
            success:true, done:true, status:"SUCCEEDED",
            videoUrl:data.videoUrl, provider:"LTX-Video GPU",
            model:data.model || "ltxv-2b-0.9.8-distilled"
          });
        }
        if (data.done && !data.success) {
          return res.status(200).json({
            success:false, done:true, status:"FAILED",
            error:data.error || "LTX не смог создать видео."
          });
        }
        return res.status(200).json({
          success:true, done:false, status:data.status || "RUNNING",
          provider:"LTX-Video GPU"
        });
      }

      return res.status(400).json({ success:false, error:"Неизвестный taskId." });
    }

    if (req.method !== "POST") return res.status(405).json({ success:false,error:"Method not allowed" });

    const body = typeof req.body === "object" && req.body ? req.body : JSON.parse(req.body || "{}");
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ success:false,error:"Введите описание движения." });

    const imageBase64 = await normalizeImage(body.imageBase64, body.imageUrl);

    // If our own GPU server is configured, use it. Otherwise use the
    // currently documented free PixelSter image-to-video endpoint directly.
    if (getLtxBaseUrl()) {
      const data = await ltxRequest("/generate", {
        method:"POST",
        body:JSON.stringify({ imageBase64, prompt })
      });
      return res.status(202).json({
        success:true, done:false, taskId:"ltx:"+data.jobId,
        status:data.status || "queued",
        provider:"LTX-Video GPU",
        model:data.model || "ltxv-2b-0.9.8-distilled"
      });
    }

    const result = await pixelsterVideo({
      prompt,
      ratio: body.aspect || body.ratio || "16:9",
      duration: body.duration || 5,
      imageBase64
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Video API error:", error);
    return res.status(500).json({
      success:false,
      error:error?.message || "Ошибка видеогенерации."
    });
  }
}
