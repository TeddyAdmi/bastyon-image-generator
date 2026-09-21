function normalizeImageInput(value) {
  const text = String(value || "").trim();

  if (text.startsWith("data:image/") && text.includes(";base64,")) {
    return {
      dataUrl: text,
      base64: text.split(",").slice(1).join(",")
    };
  }

  const raw = text.replace(/^base64,/, "").replace(/\s+/g, "");
  if (!raw || raw.length < 100) return null;

  let mediaType = "image/png";
  if (raw.startsWith("/9j/")) mediaType = "image/jpeg";
  else if (raw.startsWith("UklGR")) mediaType = "image/webp";

  return {
    dataUrl: `data:${mediaType};base64,${raw}`,
    base64: raw
  };
}

function ratioToSize(ratio) {
  const map = {
    "1:1": [1024, 1024],
    "16:9": [1536, 864],
    "9:16": [864, 1536],
    "4:3": [1365, 1024]
  };
  return map[ratio] || map["1:1"];
}

function mediaTypeFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[^;]+);base64,/i);
  return match?.[1] || "image/png";
}

function dataUrlFromBuffer(buffer, mediaType = "image/png") {
  return `data:${mediaType};base64,${Buffer.from(buffer).toString("base64")}`;
}

function extensionForType(mediaType) {
  const type = String(mediaType || "image/png").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "png";
}

async function storeImage(dataUrl, prefix = "miya") {
  if (!dataUrl) throw new Error("Нет изображения для сохранения.");

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn("BLOB_READ_WRITE_TOKEN is missing; returning data URL fallback.");
    return dataUrl;
  }

  const mediaType = mediaTypeFromDataUrl(dataUrl);
  const base64 = dataUrl.split(",").pop();
  const bytes = Buffer.from(base64, "base64");
  const filename =
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionForType(mediaType)}`;

  const { put } = await import("@vercel/blob");

  const blob = await put(filename, bytes, {
    access: "public",
    contentType: mediaType,
    addRandomSuffix: false
  });

  return blob.url;
}

async function readJsonResponse(response, providerName) {
  const text = await response.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${providerName} вернул не JSON (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `${providerName}: HTTP ${response.status}`;
    throw new Error(String(message));
  }

  return data;
}

async function legacyPixelSterGenerate({ prompt, ratio }) {
  const response = await fetch("https://ahm7xmakki.com/api/tti", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, ratio })
  });

  const data = await readJsonResponse(response, "Legacy provider");

  if (!data.imageUrl) {
    throw new Error("Legacy provider не вернул imageUrl.");
  }

  return {
    imageUrl: data.imageUrl,
    provider: "Legacy PixelSter",
    model: "Flux Dev"
  };
}

export async function generateImage(options) {
  const {
    prompt,
    ratio = "1:1"
  } = options;

  if (!String(prompt || "").trim()) {
    throw new Error("Введите промпт.");
  }

  return legacyPixelSterGenerate({ prompt, ratio });
}

export async function editImage(options) {
  const {
    prompt,
    imageBase64,
    ratio = "1:1",
    model = "or-nano-banana-2",
    quality = "auto",
    size = "auto",
    outputFormat = "png"
  } = options;

  const normalized = normalizeImageInput(imageBase64);
  if (!normalized) {
    throw new Error("Редактор не смог распознать исходное изображение.");
  }

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY не настроен в Vercel. Старый Legacy FLUX Editor отключён, потому что он возвращает HTTP 403."
    );
  }

  const selected = OPENROUTER_MODELS[model] || OPENROUTER_MODELS["or-nano-banana-2"];

  return openRouterImage({
    model: selected,
    prompt: String(prompt || "").trim(),
    ratio,
    quality,
    size,
    outputFormat,
    imageDataUrl: normalized.dataUrl
  });
}

export function getProviderStatus() {
  return {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    legacy: false
  };
}
