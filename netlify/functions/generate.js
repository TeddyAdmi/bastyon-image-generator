import { generateImage, getProviderStatus } from "../../api/_lib/image-providers.js";

export async function handler(event) {
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({
        success: true,
        providers: getProviderStatus(),
        runtime: "netlify-native"
      })
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ success: false, error: "Method not allowed" })
    };
  }

  try {
    let body = event.body || "{}";
    if (event.isBase64Encoded) body = Buffer.from(body, "base64").toString("utf8");
    body = typeof body === "string" ? JSON.parse(body) : (body || {});

    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ success: false, error: "Введите описание изображения" })
      };
    }

    const ratio = body.ratio || "1:1";
    const result = await generateImage({
      prompt,
      ratio,
      model: body.model || "auto",
      quality: body.quality || "auto",
      size: body.size || "auto",
      outputFormat: body.outputFormat || "png"
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({
        success: true,
        imageUrl: result.imageUrl,
        prompt,
        ratio,
        size: body.size || "auto",
        quality: body.quality || "auto",
        outputFormat: body.outputFormat || "png",
        provider: result.provider,
        model: result.model,
        architecture: "netlify-native"
      })
    };
  } catch (error) {
    console.error("Netlify generate error:", error);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({
        success: false,
        error: error?.message || "Ошибка генерации изображения",
        stage: "pixelster-generate",
        runtime: "netlify-native"
      })
    };
  }
}

export default { handler };
