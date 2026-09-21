const OPENROUTER_MODELS = {
  "or-nano-banana-2": "google/gemini-3.1-flash-image",
  "or-gpt-image-2": "openai/gpt-image-2",
  "or-flux-klein": "black-forest-labs/flux.2-klein-4b",
  "or-seedream-4-5": "bytedance-seed/seedream-4.5"
};

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
    dataUrl: "data:" + mediaType + ";base64," + raw,
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
  return String(dataUrl || "").match(/^data:(image\/[^;]+);base64,/i)?.[1] || "image/png";
}

function extensionForType(mediaType) {
  const type = String(mediaType || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "png";
}

async function storeImage(dataUrl, prefix = "miya") {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return dataUrl;

  const mediaType = mediaTypeFromDataUrl(dataUrl);
  const base64 = dataUrl.split(",").pop();
  const bytes = Buffer.from(base64, "base64");

  const { put } = await import("@vercel/blob");
  const blob = await put(
    prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + extensionForType(mediaType),
    bytes,
    { access: "public", contentType: mediaType, addRandomSuffix: false }
  );

  return blob.url;
}

async function readJson(response, provider) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch {
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

function editInstruction(prompt) {
  return String(prompt || "").trim() + `

STRICT IMAGE EDITING:
- Treat the supplied image as the source photograph, not as an object to redesign.
- Preserve every existing subject unless the user explicitly asks to remove or replace it.
- Perform ONLY the requested change.
- If the user asks to "add another animal", the new animal is a SEPARATE animal placed beside/in the scene. NEVER merge it into, fuse it with, replace, or grow out of an existing animal.
- Do not invent a different animal.
- Do not change the species, anatomy, face, fur, clothing, pose or identity of the original subject unless explicitly requested.
- Keep the original camera angle, composition, lighting and environment as much as possible.
- Return one coherent natural photograph, not a collage.
`;
}

async function openRouterImage({
  model,
  prompt,
  ratio,
  quality,
  size,
  outputFormat,
  imageDataUrl
}) {
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (!key) {
    throw new Error("OPENROUTER_API_KEY не настроен в Vercel.");
  }

  const body = {
    model,
    prompt: imageDataUrl ? editInstruction(prompt) : String(prompt || "").trim(),
    aspect_ratio: ratio || "1:1"
  };

  if (size && ["1024x1024", "1536x1024", "1024x1536"].includes(size)) {
    body.resolution = size === "1024x1024" ? "1K" : "2K";
  }

  if (quality && quality !== "auto") body.quality = quality;

  if (["png", "jpeg", "webp"].includes(String(outputFormat || "").toLowerCase())) {
    body.output_format = outputFormat;
  }

  if (imageDataUrl) {
    body.input_references = [{
      type: "image_url",
      image_url: { url: imageDataUrl }
    }];
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

  const data = await readJson(response, "OpenRouter");
  const item = data?.data?.[0];

  if (!item?.b64_json) {
    throw new Error("OpenRouter не вернул изображение.");
  }

  const dataUrl = "data:" + (item.media_type || "image/png") + ";base64," + item.b64_json;

  return {
    imageUrl: await storeImage(dataUrl, imageDataUrl ? "miya-edit" : "miya-image"),
    provider: "OpenRouter",
    model,
    cost: data?.usage?.cost ?? null
  };
}

async function legacyGenerate({ prompt, ratio }) {
  const response = await fetch("https://ahm7xmakki.com/api/tti", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ prompt, ratio })
  });
  const data = await readJson(response, "Legacy provider");

  if (!data.imageUrl) throw new Error("Legacy provider не вернул imageUrl.");

  return {
    imageUrl: data.imageUrl,
    provider: "Legacy PixelSter",
    model: "Flux Dev"
  };
}

export async function generateImage(options) {
  const {
    prompt,
    ratio = "1:1",
    model = "auto",
    quality = "auto",
    size = "auto",
    outputFormat = "png"
  } = options;

  const selection = String(model || "auto");

  if (selection === "legacy-flux") {
    return legacyGenerate({ prompt, ratio });
  }

  const selectedModel =
    OPENROUTER_MODELS[selection] ||
    OPENROUTER_MODELS["or-nano-banana-2"];

  return openRouterImage({
    model: selectedModel,
    prompt,
    ratio,
    quality,
    size,
    outputFormat
  });
}

export async function editImage(options) {
  const {
    prompt,
    imageBase64,
    ratio = "auto",
    model = "or-nano-banana-2",
    quality = "auto",
    size = "auto",
    outputFormat = "png"
  } = options;

  const normalized = normalizeImageInput(imageBase64);
  if (!normalized) throw new Error("Редактор не смог распознать исходное изображение.");

  const selectedModel =
    OPENROUTER_MODELS[model] ||
    OPENROUTER_MODELS["or-nano-banana-2"];

  return openRouterImage({
    model: selectedModel,
    prompt,
    ratio: ratio === "auto" ? "1:1" : ratio,
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
    legacy: true
  };
}
