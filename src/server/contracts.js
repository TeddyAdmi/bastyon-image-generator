const MODES = new Set(["image", "edit", "video", "audio"]);

export function normalizeRequest(body = {}) {
  const mode = String(body.mode || "image").trim().toLowerCase();
  if (!MODES.has(mode)) {
    const error = new Error("UNSUPPORTED_MODE");
    error.statusCode = 400;
    throw error;
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    const error = new Error("PROMPT_REQUIRED");
    error.statusCode = 400;
    throw error;
  }

  return Object.freeze({
    id: typeof body.requestId === "string" ? body.requestId : null,
    mode,
    provider:
      typeof body.provider === "string"
        ? body.provider.trim().toLowerCase()
        : "auto",
    prompt,
    ratio: typeof body.ratio === "string" ? body.ratio : "1:1",
    model: typeof body.model === "string" ? body.model : "auto",
    quality: typeof body.quality === "string" ? body.quality : "auto",
    size: typeof body.size === "string" ? body.size : "auto",
    outputFormat:
      typeof body.outputFormat === "string" ? body.outputFormat : "png",
    imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
    imageBase64:
      typeof body.imageBase64 === "string" ? body.imageBase64 : null,
    options:
      body.options && typeof body.options === "object" ? body.options : {}
  });
}

export function result(payload = {}) {
  return {
    ok: true,
    mode: payload.mode || null,
    status: payload.status || "completed",
    provider: payload.provider || null,
    model: payload.model || null,
    imageUrl: payload.imageUrl || null,
    videoUrl: payload.videoUrl || null,
    audioUrl: payload.audioUrl || null,
    requestId: payload.requestId || null,
    meta: payload.meta || {}
  };
}
