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
    throw new Error(provider + " вернул не JSON (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      provider + " HTTP " + response.status;

    throw new Error(String(message));
  }

  return data;
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
  const response = await fetch(PIXELSTER + "/tti", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      prompt: String(prompt || "").trim(),
      ratio: ratio || "1:1"
    })
  });

  const data = await parseResponse(response, "PixelSter Flux Dev");

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

  const response = await fetch(PIXELSTER + "/pti", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      prompt: editPrompt(prompt),
      ratio: ratio || "auto",
      imageBase64: normalized.base64
    })
  });

  const data = await parseResponse(response, "PixelSter Flux Kontext Dev");

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
