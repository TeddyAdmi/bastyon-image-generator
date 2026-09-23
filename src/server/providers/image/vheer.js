const provider = "vheer";

export const model = "Flux Dev";

function endpoint() {
  return String(process.env.MIYA_VHEER_URL || "").trim();
}

export function enabled() {
  return Boolean(endpoint());
}

async function request(path, payload) {
  const base = endpoint().replace(/\/$/, "");
  const response = await fetch(base + path, {
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
  if (!enabled()) {
    const error = new Error("VHEER_NOT_CONFIGURED");
    error.statusCode = 503;
    throw error;
  }

  // Provider-specific payload stays here. The router never knows Vheer's API shape.
  const data = await request("/tti", {
    prompt: input.prompt,
    ratio: input.ratio || "1:1"
  });

  if (!data?.imageUrl) {
    const error = new Error("VHEER_IMAGE_URL_MISSING");
    error.statusCode = 502;
    throw error;
  }

  return {
    provider,
    model,
    imageUrl: String(data.imageUrl),
    meta: { transport: "http-json" }
  };
}

export async function edit(input) {
  if (!enabled()) {
    const error = new Error("VHEER_NOT_CONFIGURED");
    error.statusCode = 503;
    throw error;
  }

  if (!input.imageBase64 && !input.imageUrl) {
    const error = new Error("EDIT_IMAGE_REQUIRED");
    error.statusCode = 400;
    throw error;
  }

  const data = await request("/pti", {
    prompt: input.prompt,
    ratio: input.ratio || "auto",
    imageBase64: input.imageBase64,
    imageUrl: input.imageUrl
  });

  if (!data?.imageUrl) {
    const error = new Error("VHEER_IMAGE_URL_MISSING");
    error.statusCode = 502;
    throw error;
  }

  return {
    provider,
    model: "Flux Kontext Dev",
    imageUrl: String(data.imageUrl),
    meta: { transport: "http-json" }
  };
}
