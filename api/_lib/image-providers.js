const OPENROUTER_URL = "https://openrouter.ai/api/v1/images";

const OPENROUTER_MODELS = {
  "or-nano-banana-2": "google/gemini-3.1-flash-image",
  "or-gpt-image-2": "openai/gpt-image-2",
  "or-flux-klein": "black-forest-labs/flux.2-klein-4b",
  "or-seedream-4-5": "bytedance-seed/seedream-4.5"
};

const HF_MODELS = {
  "hf-flux-schnell": "black-forest-labs/FLUX.1-schnell",
  "hf-flux-dev": "black-forest-labs/FLUX.1-dev"
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

async function openRouterImage({
  model,
  prompt,
  ratio,
  quality,
  size,
  outputFormat,
  imageDataUrl
}) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY не настроен в Vercel.");
  }

  const body = {
    model,
    prompt: imageDataUrl
      ? prompt +
        "\n\nREFERENCE-IMAGE RULES: The supplied image is the authoritative reference. Keep the same main subject, identity, face, body, pose, clothing, composition, camera angle, framing, lighting and scene unless the user explicitly requests a change. Do not add another unrelated image, duplicate the subject, replace the subject, create a collage, or overlay a second scene. Make only the requested edit and return one coherent image."
      : prompt,
    aspect_ratio: ratio || "1:1"
  };

  if (size && ["1024x1024", "1536x1024", "1024x1536"].includes(size)) {
    body.resolution = size === "1024x1024" ? "1K" : "2K";
  }

  if (quality && quality !== "auto") body.quality = quality;

  if (
    outputFormat &&
    ["png", "jpeg", "webp"].includes(String(outputFormat).toLowerCase())
  ) {
    body.output_format = outputFormat;
  }

  if (imageDataUrl) {
    body.input_references = [{
      type: "image_url",
      image_url: { url: imageDataUrl }
    }];
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.APP_URL ||
        "https://bastyon-image-generator.vercel.app/",
      "X-Title": "Miya AI"
    },
    body: JSON.stringify(body)
  });

  const data = await readJsonResponse(response, "OpenRouter");
  const item = data?.data?.[0];

  if (!item?.b64_json) {
    throw new Error("OpenRouter не вернул изображение.");
  }

  const dataUrl = dataUrlFromBuffer(
    Buffer.from(item.b64_json, "base64"),
    item.media_type || "image/png"
  );

  return {
    imageUrl: await storeImage(dataUrl, "miya-openrouter"),
    provider: "OpenRouter",
    model,
    cost: data?.usage?.cost ?? null
  };
}

async function huggingFaceGenerate({ model, prompt }) {
  if (!process.env.HF_TOKEN) {
    throw new Error("HF_TOKEN не настроен.");
  }

  const response = await fetch(
    `https://router.huggingface.co/hf-inference/models/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hugging Face HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const type = response.headers.get("content-type") || "image/png";
  const dataUrl = dataUrlFromBuffer(
    await response.arrayBuffer(),
    type.split(";")[0]
  );

  return {
    imageUrl: await storeImage(dataUrl, "miya-hf"),
    provider: "Hugging Face",
    model
  };
}

async function pollinationsGenerate({ prompt, ratio }) {
  if (!process.env.POLLINATIONS_API_KEY) {
    throw new Error("POLLINATIONS_API_KEY не настроен.");
  }

  const [width, height] = ratioToSize(ratio);

  const url =
    "https://gen.pollinations.ai/image/" +
    encodeURIComponent(prompt) +
    `?model=flux&width=${width}&height=${height}&nologo=true`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}`
    }
  });

  if (!response.ok) {
    throw new Error(`Pollinations HTTP ${response.status}`);
  }

  const contentType =
    (response.headers.get("content-type") || "image/png").split(";")[0];

  const dataUrl = dataUrlFromBuffer(
    await response.arrayBuffer(),
    contentType
  );

  return {
    imageUrl: await storeImage(dataUrl, "miya-pollinations"),
    provider: "Pollinations",
    model: "flux"
  };
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

function openRouterModelFromSelection(selection) {
  return OPENROUTER_MODELS[selection] || selection;
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

  if (selection.startsWith("or-")) {
    return openRouterImage({
      model: openRouterModelFromSelection(selection),
      prompt,
      ratio,
      quality,
      size,
      outputFormat
    });
  }

  if (selection.startsWith("hf-")) {
    const hfModel = HF_MODELS[selection];
    if (!hfModel) throw new Error("Неизвестная Hugging Face модель.");
    return huggingFaceGenerate({ model: hfModel, prompt });
  }

  if (selection === "pollinations-flux") {
    return pollinationsGenerate({ prompt, ratio });
  }

  if (selection === "legacy-flux") {
    return legacyPixelSterGenerate({ prompt, ratio });
  }

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

    if (process.env.HF_TOKEN) {
      try {
        return await huggingFaceGenerate({
          model: HF_MODELS["hf-flux-schnell"],
          prompt
        });
      } catch (error) {
        errors.push("Hugging Face: " + error.message);
      }
    }

    if (process.env.POLLINATIONS_API_KEY) {
      try {
        return await pollinationsGenerate({ prompt, ratio });
      } catch (error) {
        errors.push("Pollinations: " + error.message);
      }
    }

    if (process.env.OPENROUTER_API_KEY) {
      try {
        return await openRouterImage({
          model: OPENROUTER_MODELS["or-nano-banana-2"],
          prompt,
          ratio,
          quality,
          size,
          outputFormat
        });
      } catch (error) {
        errors.push("OpenRouter: " + error.message);
      }
    } else {
      errors.push("OpenRouter: OPENROUTER_API_KEY отсутствует");
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

  if (selection.startsWith("or-")) {
    return openRouterImage({
      model: openRouterModelFromSelection(selection),
      prompt,
      ratio,
      quality,
      size,
      outputFormat,
      imageDataUrl
    });
  }

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

  if (selection === "legacy-flux") {
    const response = await fetch("https://ahm7xmakki.com/api/pti", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        ratio,
        // Legacy FLUX editor expects the raw base64 payload.
        // normalizeImageInput also supports callers that send a full data URL.
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
  }

  throw new Error(
    "Эта модель не поддерживает редактирование. Выберите OpenRouter или Auto."
  );
}

export function getProviderStatus() {
  return {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    huggingface: Boolean(process.env.HF_TOKEN),
    pollinations: Boolean(process.env.POLLINATIONS_API_KEY),
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    legacy: true
  };
}
