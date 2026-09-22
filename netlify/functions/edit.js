import { editImage } from "../../api/_lib/image-providers.js";

export async function handler(event) {
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
        body: JSON.stringify({ success: false, error: "Введите, что изменить." })
      };
    }

    let imageBase64 = String(body.imageBase64 || "").trim();

    if (!imageBase64 && body.imageUrl) {
      const u = new URL(String(body.imageUrl));
      if (!["http:", "https:"].includes(u.protocol)) {
        throw new Error("Некорректный URL изображения.");
      }

      const response = await fetch(u.href, {
        headers: { "User-Agent": "Miya-AI/1.0" }
      });

      if (!response.ok) {
        throw new Error("Не удалось получить исходное изображение: HTTP " + response.status);
      }

      const type = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
      if (!type.startsWith("image/")) throw new Error("Источник вернул не изображение.");

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 10_000_000) throw new Error("Изображение слишком большое.");

      imageBase64 = "data:" + type + ";base64," + bytes.toString("base64");
    }

    if (!imageBase64) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ success: false, error: "Изображение не загружено." })
      };
    }

    const result = await editImage({
      prompt,
      imageBase64,
      ratio: body.ratio || "auto",
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
        provider: result.provider,
        model: result.model,
        cost: result.cost ?? null,
        runtime: "netlify-native"
      })
    };
  } catch (error) {
    console.error("Netlify edit error:", error);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({
        success: false,
        error: error?.message || "Ошибка редактирования изображения.",
        stage: "pixelster-edit",
        runtime: "netlify-native"
      })
    };
  }
}

export default { handler };
