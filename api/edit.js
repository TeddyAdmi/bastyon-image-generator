const OPENROUTER_MODELS = {
  "or-nano-banana-2": "google/gemini-3.1-flash-image",
  "or-gpt-image-2": "openai/gpt-image-2",
  "or-flux-klein": "black-forest-labs/flux.2-klein-4b"
};

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeImage(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("data:image/")) return text;
  const raw = text.replace(/^base64,/, "").replace(/\s+/g, "");
  if (raw.length < 100) return "";
  let type = "image/png";
  if (raw.startsWith("/9j/")) type = "image/jpeg";
  if (raw.startsWith("UklGR")) type = "image/webp";
  return "data:" + type + ";base64," + raw;
}

async function urlToDataUrl(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Miya-AI/1.0" }
  });

  const bytes = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error("Не удалось получить исходное изображение: HTTP " + response.status);
  }

  const contentType = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!contentType.startsWith("image/")) {
    throw new Error("URL не вернул изображение.");
  }

  if (bytes.length > 8_000_000) {
    throw new Error("Изображение слишком большое. Максимум около 6 MB.");
  }

  return "data:" + contentType + ";base64," + bytes.toString("base64");
}

async function saveImage(dataUrl) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return dataUrl;

  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  if (!match) return dataUrl;

  const mime = match[1];
  const bytes = Buffer.from(match[2], "base64");
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
  if (!key) {
    throw new Error("OPENROUTER_API_KEY не настроен в Vercel.");
  }

  const body = {
    model,
    prompt:
      prompt +
      "\n\nEDIT RULES: Treat the supplied image as the source image. Keep the main subject, identity, face, body, clothing, composition and camera perspective unless the user explicitly asks to change them. Make only the requested edit. Return one coherent image, not a collage.",
    input_references: [
      {
        type: "image_url",
        image_url: { url: image }
      }
    ]
  };

  if (ratio) body.aspect_ratio = ratio;
  if (size && ["1024x1024", "1536x1024", "1024x1536"].includes(size)) {
    body.resolution = size === "1024x1024" ? "1K" : "2K";
  }
  if (quality && quality !== "auto") body.quality = quality;
  if (["png", "jpeg", "webp"].includes(String(outputFormat || "").toLowerCase())) {
    body.output_format = outputFormat;
  }

  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://bastyon-image-generator.vercel.app/",
      "X-Title": "Miya AI"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("OpenRouter вернул не JSON (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      ("OpenRouter HTTP " + response.status);
    throw new Error(String(message));
  }

  const item = data?.data?.[0];
  if (!item?.b64_json) {
    throw new Error("OpenRouter не вернул отредактированное изображение.");
  }

  const mime = item.media_type || "image/png";
  const result = "data:" + mime + ";base64," + item.b64_json;

  return {
    imageUrl: await saveImage(result),
    provider: "OpenRouter",
    model
  };
}

async function legacyEdit({ prompt, image, ratio }) {
  const raw = image.split(",").pop();
  const response = await fetch("https://ahm7xmakki.com/api/pti", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, ratio, imageBase64: raw })
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error("Legacy editor вернул не JSON (HTTP " + response.status + ")."); }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error ||
      data?.message ||
      ("Legacy editor HTTP " + response.status)
    );
  }

  if (!data.imageUrl) throw new Error("Legacy editor не вернул imageUrl.");

  return { imageUrl: data.imageUrl, provider: "Legacy PixelSter", model: "Flux Kontext Dev" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    const modelKey = String(body.model || "or-nano-banana-2");
    const modelMap = {\n      "or-nano-banana-2": "google/gemini-3.1-flash-image",\n      "or-gpt-image-2": "openai/gpt-image-2",\n      "or-flux-klein": "black-forest-labs/flux.2-klein-4b"\n    };\n    const model = modelMap[modelKey] || modelKey;
    const ratio = body.ratio || "1:1";
    const quality = body.quality || "auto";
    const size = body.size || "auto";
    const outputFormat = body.outputFormat || "png";

    if (!prompt) {
      return res.status(400).json({ success: false, error: "Введите описание изменения." });
    }

    let image = normalizeImage(body.imageBase64);

    if (!image && isHttpUrl(body.imageUrl)) {
      image = await urlToDataUrl(body.imageUrl);
    }

    if (!image) {
      return res.status(400).json({ success: false, error: "Изображение не загружено." });
    }

    if (image.length > 8_000_000) {
      return res.status(413).json({ success: false, error: "Изображение слишком большое. Максимум около 6 MB." });
    }

    // OpenRouter is the explicit photo-editor backend.
    if (modelKey.startsWith("or-")) {
      const result = await openRouterEdit({
        model,
        prompt,
        image,
        ratio,
        quality,
        size,
        outputFormat
      });

      return res.status(200).json({
        success: true,
        imageUrl: result.imageUrl,
        provider: result.provider,
        model: result.model,
        architecture: "openrouter-image-edit"
      });
    }

    if (modelKey === "legacy-flux") {
      const result = await legacyEdit({ prompt, image, ratio });
      return res.status(200).json({
        success: true,
        imageUrl: result.imageUrl,
        provider: result.provider,
        model: result.model
      });
    }

    throw new Error("Неизвестная модель редактора: " + modelKey);
  } catch (error) {
    console.error("Edit error:", error);
    const message =
      typeof error?.message === "string" ? error.message :
      typeof error === "string" ? error :
      "Ошибка редактирования изображения.";

    return res.status(502).json({
      success: false,
      error: message
    });
  }
}
