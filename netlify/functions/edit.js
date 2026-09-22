import { editImage } from "../../api/_lib/image-providers.js";

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
  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await request.json();
    const prompt = String(body?.prompt || "").trim();

    if (!prompt) {
      return json({ success: false, error: "Введите, что изменить." }, 400);
    }

    let imageBase64 = String(body?.imageBase64 || "").trim();

    if (!imageBase64 && body?.imageUrl) {
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

      if (!type.startsWith("image/")) {
        throw new Error("Источник вернул не изображение.");
      }

      const bytes = Buffer.from(await response.arrayBuffer());

      if (bytes.length > 10_000_000) {
        throw new Error("Изображение слишком большое.");
      }

      imageBase64 = "data:" + type + ";base64," + bytes.toString("base64");
    }

    if (!imageBase64) {
      return json({ success: false, error: "Изображение не загружено." }, 400);
    }

    const result = await editImage({
      prompt,
      imageBase64,
      ratio: body?.ratio || "auto",
      model: body?.model || "auto",
      quality: body?.quality || "auto",
      size: body?.size || "auto",
      outputFormat: body?.outputFormat || "png"
    });

    return json({
      success: true,
      imageUrl: result.imageUrl,
      provider: result.provider,
      model: result.model,
      cost: result.cost ?? null,
      runtime: "netlify-native"
    });
  } catch (error) {
    console.error("Netlify edit error:", error);
    return json({
      success: false,
      error: error?.message || "Ошибка редактирования изображения.",
      stage: "pixelster-edit",
      runtime: "netlify-native"
    }, 502);
  }
}
