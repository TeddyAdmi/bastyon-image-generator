import { getImageProvider } from "../providers/registry.js";

function providerName(request) {
  return String(
    request.provider !== "auto"
      ? request.provider
      : process.env.MIYA_IMAGE_PROVIDER || "vheer"
  )
    .trim()
    .toLowerCase();
}

export async function routeImage(request) {
  const name = providerName(request);
  const provider = getImageProvider(name);

  if (!provider) {
    const error = new Error("IMAGE_PROVIDER_NOT_FOUND:" + name);
    error.statusCode = 503;
    throw error;
  }

  if (!provider.enabled()) {
    const error = new Error("IMAGE_PROVIDER_NOT_CONFIGURED:" + name);
    error.statusCode = 503;
    throw error;
  }

  const input = {
    prompt: request.prompt,
    ratio: request.ratio,
    model: request.model,
    quality: request.quality,
    size: request.size,
    outputFormat: request.outputFormat,
    imageUrl: request.imageUrl,
    imageBase64: request.imageBase64,
    options: request.options
  };

  const response =
    request.mode === "edit"
      ? await provider.edit(input)
      : await provider.generate(input);

  return {
    provider: response.provider || name,
    model: response.model || request.model || null,
    imageUrl: response.imageUrl || null,
    meta: response.meta || {}
  };
}
