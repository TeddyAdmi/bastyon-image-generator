const provider = "vheer";

export const model = "Flux Dev";

function generateEndpoint() {
  return String(process.env.MIYA_VHEER_GENERATE_URL || "").trim();
}

function editEndpoint() {
  return String(process.env.MIYA_VHEER_EDIT_URL || "").trim();
}

export function enabled() {
  return Boolean(generateEndpoint());
}

function extractImageUrl(data) {
  const candidates = [
    data?.imageUrl,
    data?.image_url,
    data?.url,
    data?.output?.imageUrl,
    data?.output?.url,
    Array.isArray(data?.images) ? data.images[0] : null,
    Array.isArray(data?.output) ? data.output[0] : null
  ];

  return candidates.find(
    value => typeof value === "string" && /^https?:\/\//i.test(value)
  ) || null;
}

async function post(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const error = new Error("VHEER_NON_JSON_RESPONSE");
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(
      String(data?.error || data?.message || "VHEER_HTTP_" + response.status)
    );
    error.statusCode = 502;
    throw error;
  }

  return data;
}

export async function generate(input) {
  const url = generateEndpoint();
  if (!url) {
    const error = new Error("VHEER_NOT_CONFIGURED");
    error.statusCode = 503;
    throw error;
  }

  const data = await post(url, {
    prompt: input.prompt,
    ratio: input.ratio,
    model: input.model,
    quality: input.quality,
    size: input.size,
    outputFormat: input.outputFormat,
    ...input.options
  });

  const imageUrl = extractImageUrl(data);
  if (!imageUrl) {
    const error = new Error("VHEER_IMAGE_URL_MISSING");
    error.statusCode = 502;
    throw error;
  }

  return {
    provider,
    model: input.model !== "auto" ? input.model : model,
    imageUrl,
    meta: { transport: "http-json" }
  };
}

export async function edit(input) {
  const url = editEndpoint();
  if (!url) {
    const error = new Error("VHEER_EDIT_NOT_CONFIGURED");
    error.statusCode = 503;
    throw error;
  }

  const data = await post(url, {
    prompt: input.prompt,
    ratio: input.ratio,
    model: input.model,
    imageUrl: input.imageUrl,
    imageBase64: input.imageBase64,
    ...input.options
  });

  const imageUrl = extractImageUrl(data);
  if (!imageUrl) {
    const error = new Error("VHEER_IMAGE_URL_MISSING");
    error.statusCode = 502;
    throw error;
  }

  return {
    provider,
    model: input.model !== "auto" ? input.model : "Flux Kontext Dev",
    imageUrl,
    meta: { transport: "http-json" }
  };
}
