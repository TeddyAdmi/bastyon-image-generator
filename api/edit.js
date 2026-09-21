const MODELS = {
  "or-nano-banana-2": "google/gemini-3.1-flash-image",
  "or-gpt-image-2": "openai/gpt-image-2",
  "or-flux-klein": "black-forest-labs/flux.2-klein-4b"
};

function asDataUrl(value) {
  const text = String(value || "").trim();
  if (text.startsWith("data:image/")) return text;
  const raw = text.replace(/^base64,/, "").replace(/\s+/g, "");
  if (raw.length < 100) return "";
  let mime = "image/png";
  if (raw.startsWith("/9j/")) mime = "image/jpeg";
  else if (raw.startsWith("UklGR")) mime = "image/webp";
  return "data:" + mime + ";base64," + raw;
}

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
  if (!r.ok) throw new Error("Не удалось получить изображение: HTTP " + r.status);
  const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!mime.startsWith("image/")) throw new Error("Источник не является изображением.");
  if (bytes.length > 8_000_000) throw new Error("Изображение слишком большое.");
  return "data:" + mime + ";base64," + bytes.toString("base64");
}

async function saveImage(dataUrl) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return dataUrl;
  const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  if (!m) return dataUrl;
  const mime = m[1];
  const bytes = Buffer.from(m[2], "base64");
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const { put } = await import("@vercel/blob");
  const blob = await put(
    "miya-edits/" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext,
    bytes,
    { access: "public", contentType: mime, addRandomSuffix: false }
  );
  return blob.url;
}

async function openRouterEdit({ model, prompt, image, ratio, quality, size, outputFormat }) {
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("OPENROUTER_API_KEY не настроен в Vercel.");

  const body = {
    model,
    prompt:
      prompt +
      "\n\nEDIT RULES: Use the supplied image as the source. Preserve the main subject, identity, face, clothing, composition and camera perspective unless the user explicitly requests a change. Make only the requested edit. Return one coherent image.",
    input_references: [{ type: "image_url", image_url: { url: image } }]
  };

  if (ratio) body.aspect_ratio = ratio;
  if (size && ["1024x1024", "1536x1024", "1024x1536"].includes(size)) {
    body.resolution = size === "1024x1024" ? "1K" : "2K";
  }
  if (quality && quality !== "auto") body.quality = quality;
  if (["png", "jpeg", "webp"].includes(String(outputFormat).toLowerCase())) {
    body.output_format = outputFormat;
  }

  const r = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://bastyon-image-generator.vercel.app/",
      "X-Title": "Miya AI"
    },
    body: JSON.stringify(body)
  });

  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error("OpenRouter вернул не JSON (HTTP " + r.status + ")."); }

  if (!r.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error ||
      data?.message ||
      ("OpenRouter HTTP " + r.status)
    );
  }

  const item = data?.data?.[0];
  if (!item?.b64_json) throw new Error("OpenRouter не вернул изображение.");

  const mime = item.media_type || "image/png";
  const result = "data:" + mime + ";base64," + item.b64_json;

  return {
    imageUrl: await saveImage(result),
    provider: "OpenRouter",
    model
  };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = String(body.prompt || "").trim();
    const modelKey = String(body.model || "or-nano-banana-2");
    const model = MODELS[modelKey];

    if (!prompt) return res.status(400).json({ success: false, error: "Введите описание изменения." });
    if (!model) return res.status(400).json({ success: false, error: "Неизвестная модель редактора." });

    let image = asDataUrl(body.imageBase64);
    if (!image && isUrl(body.imageUrl)) image = await urlToDataUrl(body.imageUrl);
    if (!image) return res.status(400).json({ success: false, error: "Изображение не загружено." });

    const result = await openRouterEdit({
      model,
      prompt,
      image,
      ratio: body.ratio || "1:1",
      quality: body.quality || "auto",
      size: body.size || "auto",
      outputFormat: body.outputFormat || "png"
    });

    return res.status(200).json({
      success: true,
      imageUrl: result.imageUrl,
      provider: result.provider,
      model: result.model
    });
  } catch (error) {
    console.error("Edit API:", error);
    const message = error?.message || "Ошибка редактирования изображения.";
    const providerUnavailable =
      /Insufficient credits|never purchased credits|OPENROUTER_API_KEY|HTTP 402|HTTP 403/i.test(message);
    return res.status(providerUnavailable ? 503 : 500).json({
      success: false,
      code: providerUnavailable ? "EDITOR_PROVIDER_UNAVAILABLE" : "EDITOR_ERROR",
      error: message
    });
  }
}
