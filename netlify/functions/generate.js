import { generateImage, getProviderStatus } from "../../api/_lib/image-providers.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default async function handler(request) {
  if (request.method === "GET") {
    return json({
      success: true,
      providers: getProviderStatus(),
      runtime: "netlify-native"
    });
  }

  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await request.json();
    const prompt = String(body?.prompt || "").trim();

    if (!prompt) {
      return json({ success: false, error: "Введите описание изображения" }, 400);
    }

    const ratio = body?.ratio || "1:1";
    const result = await generateImage({
      prompt,
      ratio,
      model: body?.model || "auto",
      quality: body?.quality || "auto",
      size: body?.size || "auto",
      outputFormat: body?.outputFormat || "png"
    });

    return json({
      success: true,
      imageUrl: result.imageUrl,
      prompt,
      ratio,
      size: body?.size || "auto",
      quality: body?.quality || "auto",
      outputFormat: body?.outputFormat || "png",
      provider: result.provider,
      model: result.model,
      architecture: "netlify-native"
    });
  } catch (error) {
    console.error("Netlify generate error:", error);
    return json({
      success: false,
      error: error?.message || "Ошибка генерации изображения",
      stage: "pixelster-generate",
      runtime: "netlify-native"
    }, 502);
  }
}
