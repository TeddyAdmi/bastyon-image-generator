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

function cleanDataUrl(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.startsWith("data:image/")) return text;
  return "";
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
  const match = String(dataUrl || "").match(/^data:(image\\/[^;]+);base64,/i);
  return match?.[1] || "image/png";
}

function dataUrlFromBuffer(buffer, mediaType = "image/png") {
  const bytes = Buffer.from(buffer);
  return `data:${mediaType};base64,${bytes.toString("base64")}`;
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
    throw new Error("OPENROUTER_API_KEY не настроен.");
  }

  const body = {
    model,
    prompt,
    aspect_ratio: ratio || "1:1"
  };

  const resolutionMap = {
    "1024x1024": "1K",
    "1536x1024": "2K",
    "1024x1536": "2K"
  };

  if (size && resolutionMap[size]) body.resolution = resolutionMap[size];
  if (quality && quality !== "auto") body.quality = quality;
  if (outputFormat && ["png", "jpeg", "webp"].includes(outputFormat)) {
    body.output_format = outputFormat;
  }

  if (imageDataUrl) {
    body.input_references = [
      {
        type: "image_url",
        image_url: { url: imageDataUrl }
      }
    ];
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://bastyon-image-generator.vercel.app/",
      "X-Title": "Miya AI"
    },
    body: JSON.stringify(body)
  });

  const data = await readJsonResponse(response, "OpenRouter");
  const item = data?.data?.[0];

  if (!item?.b64_json) {
    throw new Error("OpenRouter не вернул изображение.");
  }

  return {
    imageUrl: `data:${item.media_type || "image/png"};base64,${item.b64_json}`,
    provider: "OpenRouter",
    model
  };
}

async function huggingFaceGenerate({ model, prompt }) {
  if (!process.env.HF_TOKEN) {
    throw new Error("HF_TOKEN не настроен.");
  }

  const { InferenceClient } = await import("@huggingface/inference");
  const client = new InferenceClient(process.env.HF_TOKEN);
  const image = await client.textToImage({
    model,
    inputs: prompt
  });

  return {
    imageUrl: dataUrlFromBuffer(await image.arrayBuffer(), image.type || "image/png"),
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
    throw new Error(`Pollinations: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  return {
    imageUrl: dataUrlFromBuffer(await response.arrayBuffer(), contentType.split(";")[0]),
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

    try {
      return await legacyPixelSterGenerate({ prompt, ratio });
    } catch (error) {
      errors.push("Legacy: " + error.message);
    }

    throw new Error(
      "Не удалось создать изображение ни у одного провайдера. " +
      errors.join(" | ")
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

  const imageDataUrl =
    cleanDataUrl(imageBase64) ||
    `data:${mediaTypeFromDataUrl(imageBase64)};base64,${String(imageBase64 || "").split(",").pop()}`;

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
    if (process.env.OPENROUTER_API_KEY) {
      return openRouterImage({
        model: OPENROUTER_MODELS["or-nano-banana-2"],
        prompt,
        ratio,
        quality,
        size,
        outputFormat,
        imageDataUrl
      });
    }

    if (process.env.POLLINATIONS_API_KEY) {
      throw new Error(
        "Для редактирования изображения настройте OPENROUTER_API_KEY. " +
        "Pollinations оставлен резервным генератором, а не редактором."
      );
    }

    throw new Error(
      "Для редактирования нужен OPENROUTER_API_KEY. " +
      "После его добавления режим Auto заработает автоматически."
    );
  }

  if (selection === "legacy-flux") {
    const response = await fetch("https://ahm7xmakki.com/api/pti", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        ratio,
        imageBase64
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
    "Эта модель не поддерживает редактирование через выбранный провайдер. " +
    "Выберите OpenRouter или Auto."
  );
}

export function getProviderStatus() {
  return {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    huggingface: Boolean(process.env.HF_TOKEN),
    pollinations: Boolean(process.env.POLLINATIONS_API_KEY),
    legacy: true
  };
}
