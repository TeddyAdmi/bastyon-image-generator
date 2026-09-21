const OPENROUTER_MODELS = {
  "or-nano-banana-2": "google/gemini-3.1-flash-image",
  "or-gpt-image-2": "openai/gpt-image-2",
  "or-flux-klein": "black-forest-labs/flux.2-klein-4b"
};

function normalizeImage(value) {
  const text = String(value || "").trim();
  if (text.startsWith("data:image/") && text.includes(";base64,")) {
    return {
      dataUrl: text,
      base64: text.split(",").slice(1).join(",")
    };
  }

  const raw = text.replace(/^base64,/, "").replace(/\s+/g, "");
  if (raw.length < 100) return null;

  let mime = "image/png";
  if (raw.startsWith("/9j/")) mime = "image/jpeg";
  else if (raw.startsWith("UklGR")) mime = "image/webp";

  return {
    dataUrl: "data:" + mime + ";base64," + raw,
    base64: raw
  };
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
  const response = await fetch(url, {
    headers: { "User-Agent": "Miya-AI/1.0" }
  });

  const bytes = Buffer.from(await response.arrayBuffer());

  if (!response.ok) {
    throw new Error("Не удалось получить изображение: HTTP " + response.status);
  }

  const mime = (response.headers.get("content-type") || "image/jpeg").split(";")[0];

  if (!mime.startsWith("image/")) {
    throw new Error("Источник не является изображением.");
  }

  if (bytes.length > 8_000_000) {
    throw new Error("Изображение слишком большое.");
  }

  return {
    dataUrl: "data:" + mime + ";base64," + bytes.toString("base64"),
    base64: bytes.toString("base64")
  };
}

async function saveImage(dataUrl) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return dataUrl;

  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  if (!match) return dataUrl;

  const mime = match[1];
  const bytes = Buffer.from(match[2], "base64");
  const ext =
    mime.includes("jpeg") || mime.includes("jpg") ? "jpg" :
    mime.includes("webp") ? "webp" : "png";

  const { put } = await import("@vercel/blob");

  const blob = await put(
    "miya-edits/" +
      Date.now() + "-" +
      Math.random().toString(36).slice(2) + "." + ext,
    bytes,
    {
      access: "public",
      contentType: mime,
      addRandomSuffix: false
    }
  );

  return blob.url;
}

async function legacyEdit({ prompt, imageBase64, ratio }) {
  const response = await fetch("https://ahm7xmakki.com/api/pti", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      "Origin": "https://www.ahm7xmakki.com",
      "Referer": "https://www.ahm7xmakki.com/pixelster"
    },
    body: JSON.stringify({
      prompt,
      ratio: ratio || "auto",
      imageBase64
    })
  });

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      "Legacy editor вернул не JSON (HTTP " +
      response.status +
      ")."
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      ("Legacy editor HTTP " + response.status);

    throw new Error(String(message));
  }

  if (!data.imageUrl) {
    throw new Error("Legacy editor не вернул imageUrl.");
  }

  return {
    imageUrl: data.imageUrl,
    provider: "Legacy PixelSter",
    model: "Flux Kontext Dev"
  };
}

async function openRouterEdit({
  model,
  prompt,
  image,
  ratio,
  quality,
  size,
  outputFormat
}) {
  const key = String(process.env.OPENROUTER_API_KEY || "").trim();

  if (!key) {
    throw new Error("OPENROUTER_API_KEY не настроен в Vercel.");
  }

  const body = {
    model,
    prompt:
      prompt +
      "\n\nEDIT RULES: Use the supplied image as the source. Preserve the main subject, identity, face, clothing, composition and camera perspective unless the user explicitly requests a change. Make only the requested edit. Return one coherent image.",
    input_references: [
      {
        type: "image_url",
        image_url: { url: image }
      }
    ]
  };

  if (ratio) body.aspect_ratio = ratio;

  if (
    size &&
    ["1024x1024", "1536x1024", "1024x1536"].includes(size)
  ) {
    body.resolution = size === "1024x1024" ? "1K" : "2K";
  }

  if (quality && quality !== "auto") {
    body.quality = quality;
  }

  if (
    ["png", "jpeg", "webp"].includes(
      String(outputFormat || "").toLowerCase()
    )
  ) {
    body.output_format = outputFormat;
  }

  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.APP_URL ||
        "https://bastyon-image-generator.vercel.app/",
      "X-Title": "Miya AI"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      "OpenRouter вернул не JSON (HTTP " +
      response.status +
      ")."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error ||
      data?.message ||
      ("OpenRouter HTTP " + response.status)
    );
  }

  const item = data?.data?.[0];

  if (!item?.b64_json) {
    throw new Error("OpenRouter не вернул изображение.");
  }

  const mime = item.media_type || "image/png";
  const result =
    "data:" + mime + ";base64," + item.b64_json;

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
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const prompt = String(body.prompt || "").trim();

    /*
     * IMPORTANT:
     * The original working Miya editor used:
     * Flux Dev for generation
     * Flux Kontext Dev for image editing.
     *
     * Keep that path alive. "auto" and "legacy-flux" both mean
     * Flux Kontext Dev, not an OpenRouter model.
     */
    const selection = String(body.model || "auto");

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Введите описание изменения."
      });
    }

    let normalized = normalizeImage(body.imageBase64);

    if (!normalized && isUrl(body.imageUrl)) {
      normalized = await urlToDataUrl(body.imageUrl);
    }

    if (!normalized) {
      return res.status(400).json({
        success: false,
        error: "Изображение не загружено."
      });
    }

    if (selection === "auto" || selection === "legacy-flux") {
      try {
        const result = await legacyEdit({
          prompt,
          imageBase64: normalized.base64,
          ratio: body.ratio || "1:1"
        });

        return res.status(200).json({
          success: true,
          imageUrl: result.imageUrl,
          provider: result.provider,
          model: result.model
        });
      } catch (legacyError) {
        console.error("Flux Kontext Dev editor:", legacyError);

        /*
         * Do not silently replace an image editor with a text-to-image
         * generator. Only use OpenRouter when it is explicitly selected.
         */
        return res.status(502).json({
          success: false,
          code: "LEGACY_EDITOR_ERROR",
          error:
            "Flux Kontext Dev сейчас не ответил: " +
            (legacyError?.message || String(legacyError))
        });
      }
    }

    if (selection.startsWith("or-")) {
      const model = OPENROUTER_MODELS[selection];

      if (!model) {
        return res.status(400).json({
          success: false,
          error: "Неизвестная модель OpenRouter редактора."
        });
      }

      const result = await openRouterEdit({
        model,
        prompt,
        image: normalized.dataUrl,
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
    }

    return res.status(400).json({
      success: false,
      error: "Неизвестная модель редактора: " + selection
    });
  } catch (error) {
    console.error("Edit API:", error);

    return res.status(500).json({
      success: false,
      code: "EDITOR_ERROR",
      error: error?.message || "Ошибка редактирования изображения."
    });
  }
}
