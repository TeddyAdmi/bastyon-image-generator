const PIXELSTER = "https://ahm7xmakki.com/api";

function isUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function urlToDataUrl(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Miya-AI/1.0" }
  });

  if (!response.ok) {
    throw new Error("Не удалось получить исходное изображение: HTTP " + response.status);
  }

  const mime = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) {
    throw new Error("Источник не является изображением.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 3_500_000) {
    throw new Error("PixelSter принимает изображение до 3.5 MB.");
  }

  return "data:" + mime + ";base64," + bytes.toString("base64");
}

async function normalizeImage(imageBase64, imageUrl) {
  const value = String(imageBase64 || "").trim();
  if (value.startsWith("data:image/")) return value;

  if (isUrl(imageUrl)) {
    return urlToDataUrl(imageUrl);
  }

  throw new Error("Исходное изображение не найдено.");
}

async function pixelsterVideo({ prompt, ratio, duration, imageBase64 }) {
  const response = await fetch(PIXELSTER + "/ptv", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      prompt: String(prompt || "").trim(),
      ratio: ratio || "9:16",
      duration: Math.min(20, Math.max(5, Number(duration) || 6)),
      imageBase64
    })
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("PixelSter Image→Video вернул не JSON (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      "PixelSter Image→Video HTTP " + response.status;

    throw new Error(String(message));
  }

  if (!data.videoUrl) {
    throw new Error("PixelSter не вернул videoUrl.");
  }

  return data;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      if (String(req.query?.health || "") === "1") {
        return res.status(200).json({
          success: true,
          provider: "AHM7 PixelSter",
          model: "Motion synthesis",
          endpoint: "/api/ptv",
          free: true,
          auth: false
        });
      }

      return res.status(400).json({
        success: false,
        error: "Видео PixelSter теперь возвращается сразу через /api/ptv."
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});

    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Введите сценарий движения."
      });
    }

    const image = await normalizeImage(body.imageBase64, body.imageUrl);

    const data = await pixelsterVideo({
      prompt,
      ratio: body.aspect || body.ratio || "9:16",
      duration: body.duration || 6,
      imageBase64: image.split(",").slice(1).join(",")
    });

    return res.status(200).json({
      success: true,
      done: true,
      videoUrl: data.videoUrl,
      prompt,
      ratio: data.ratio || body.aspect || body.ratio || "9:16",
      provider: "AHM7 PixelSter",
      model: "Motion synthesis"
    });
  } catch (error) {
    console.error("Miya PixelSter video API:", error);

    return res.status(502).json({
      success: false,
      error: error?.message || "Ошибка PixelSter Image→Video."
    });
  }
}
