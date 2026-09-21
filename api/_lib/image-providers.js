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
    ratio = "1:1",
    model = "auto",
    quality = "auto",
    size = "auto",
    outputFormat = "png"
  } = options;

  const selection = String(model || "auto");

  if (selection === "auto") {
    const errors = [];

    // AUTO deliberately starts with the existing FLUX service.
    // This keeps the current free/working generation path in front of
    // paid OpenRouter image generation.
    try {
      return await legacyPixelSterGenerate({ prompt, ratio });
    } catch (error) {
      errors.push("FLUX Legacy: " + error.message);
    }

    throw new Error(
      "Не удалось создать изображение. " + errors.join(" | ")
    );
  }

  throw new Error("Неизвестная модель генерации.");
}

export async function editImage(options) {
  const {
    prompt,
    imageBase64,
    ratio = "1:1",
    model = "auto",
    quality = "auto",
    size = "auto",
    outputFormat = "png"
  } = options;

  const normalized = normalizeImageInput(imageBase64);

  if (!normalized) {
    throw new Error("Редактор не смог распознать изображение. Поддерживается data:image/...;base64 или обычный base64.");
  }

  const imageDataUrl = normalized.dataUrl;
  const selection = String(model || "auto");

  if (selection === "auto") {
    const errors = [];

    // Редактор AUTO: сначала основной рабочий FLUX Editor.
    // Платные/дополнительные провайдеры используются только как fallback.
    try {
      const normalized = normalizeImageInput(imageBase64);
      if (!normalized) throw new Error("Не удалось распознать исходное изображение.");

      const response = await fetch("https://ahm7xmakki.com/api/pti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          ratio,
          imageBase64: normalized.base64
        })
      });

      const data = await readJsonResponse(response, "Legacy editor");

      if (!data.imageUrl) {
        throw new Error("Legacy editor не вернул imageUrl.");
      }

      return {
        imageUrl: data.imageUrl,
        provider: "Legacy PixelSter",
        model: "Flux Kontext Dev"
      };
    } catch (error) {
      errors.push("Основной FLUX Editor: " + error.message);
    }

    if (process.env.HF_TOKEN) {
      try {
        throw new Error("Hugging Face image editing не подключён для этого редактора.");
      } catch (error) {
        errors.push("Hugging Face: " + error.message);
      }
    }

    // Legacy PixelSter can return 403. If OpenRouter is configured,
    // use the selected image-editing model instead of leaving the editor dead.
    if (process.env.OPENROUTER_API_KEY) {
      try {
        return await openRouterImage({
          model: OPENROUTER_MODELS["or-nano-banana-2"],
          prompt,
          ratio,
          quality,
          size,
          outputFormat,
          imageDataUrl
        });
      } catch (error) {
        errors.push("OpenRouter: " + error.message);
      }
    }

    throw new Error(
      "Редактор сейчас недоступен. Основной Flux Kontext вернул ошибку, а резервный провайдер не настроен. " +
      errors.join(" | ")
    );
  }

  throw new Error(
    "Эта модель не поддерживает редактирование. Выберите OpenRouter или Auto."
  );
}

export function getProviderStatus() {
  return {
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    legacy: true
  };
}
