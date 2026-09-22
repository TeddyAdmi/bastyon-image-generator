const PIXELSTER = "https://ahm7xmakki.com/api";

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

async function parseResponse(response, provider) {
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const detail = text ? " " + text.slice(0, 300).replace(/\s+/g, " ").trim() : "";
    throw new Error(provider + " вернул не JSON (HTTP " + response.status + ")." + detail);
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      provider + " HTTP " + response.status;

    const error = new Error(String(message));
    error.upstreamStatus = response.status;
    error.provider = provider;
    throw error;
  }

  return data;
}

async function postPixelster(path, payload, provider) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 55000);

      let response;
      try {
        response = await fetch(PIXELSTER + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      return await parseResponse(response, provider);
    } catch (error) {
      lastError = error;
      const status = Number(error?.upstreamStatus || 0);
      const retryable =
        error?.name === "AbortError" ||
        status === 408 ||
        status === 429 ||
        status >= 500;

      if (!retryable || attempt === 2) break;

      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError || new Error(provider + " не ответил.");
}

function editPrompt(prompt) {
  return String(prompt || "").trim() + `

STRICT IMAGE EDIT:
- Use the supplied image as the exact source image.
- Preserve the original main subject, identity, species, anatomy, face, clothing, pose, camera angle and environment unless explicitly asked to change them.
- Make only the requested modification.
- If the request says to add an animal, create a separate new animal beside/in the scene; never merge it with the existing subject.
- Do not replace the original subject.
- Return one coherent natural photograph, not a collage.
`;
}

async function pixelsterGenerate({ prompt, ratio }) {
  const data = await postPixelster(
    "/tti",
    {
      prompt: String(prompt || "").trim(),
      ratio: ratio || "1:1"
    },
    "PixelSter Flux Dev"
  );

  if (!data.imageUrl) {
    throw new Error("PixelSter не вернул imageUrl.");
  }

  return {
    imageUrl: data.imageUrl,
    provider: "AHM7 PixelSter",
    model: "Flux Dev"
  };
}

async function pixelsterEdit({ prompt, imageBase64, ratio }) {
  const normalized = normalizeImageInput(imageBase64);

  if (!normalized) {
    throw new Error("Редактор не смог распознать исходное изображение.");
  }

  const data = await postPixelster(
    "/pti",
    {
      prompt: editPrompt(prompt),
      ratio: ratio || "auto",
      imageBase64: normalized.base64
    },
    "PixelSter Flux Kontext Dev"
  );

  if (!data.imageUrl) {
    throw new Error("PixelSter не вернул imageUrl.");
  }

  return {
    imageUrl: data.imageUrl,
    provider: "AHM7 PixelSter",
    model: "Flux Kontext Dev"
  };
}

export async function generateImage(options) {
  return pixelsterGenerate(options);
}

export async function editImage(options) {
  return pixelsterEdit(options);
}

export function getProviderStatus() {
  return {
    pixelster: true,
    textToImage: "Flux Dev",
    imageToImage: "Flux Kontext Dev",
    imageToVideo: "Motion synthesis",
    auth: false
  };
}

export { normalizeImageInput };
