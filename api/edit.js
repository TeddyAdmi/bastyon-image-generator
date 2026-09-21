import { editImage } from "./_lib/image-providers.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ success:false, error:"Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return res.status(400).json({success:false,error:"Введите, что изменить."});

    let imageBase64 = String(body.imageBase64 || "").trim();

    if (!imageBase64 && body.imageUrl) {
      const u = new URL(String(body.imageUrl));
      if (!["http:","https:"].includes(u.protocol)) throw new Error("Некорректный URL изображения.");

      const r = await fetch(u.href, {headers:{"User-Agent":"Miya-AI/1.0"}});
      if (!r.ok) throw new Error("Не удалось получить исходное изображение: HTTP " + r.status);

      const type = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
      if (!type.startsWith("image/")) throw new Error("Источник вернул не изображение.");

      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > 10_000_000) throw new Error("Изображение слишком большое.");

      imageBase64 = "data:" + type + ";base64," + bytes.toString("base64");
    }

    if (!imageBase64) return res.status(400).json({success:false,error:"Изображение не загружено."});

    const result = await editImage({
      prompt,
      imageBase64,
      ratio: body.ratio || "auto",
      model: body.model || "or-nano-banana-2",
      quality: body.quality || "auto",
      size: body.size || "auto",
      outputFormat: body.outputFormat || "png"
    });

    return res.status(200).json({
      success:true,
      imageUrl:result.imageUrl,
      provider:result.provider,
      model:result.model,
      cost:result.cost ?? null
    });
  } catch (error) {
    console.error("Edit API:",error);
    return res.status(502).json({
      success:false,
      error:error?.message || "Ошибка редактирования изображения."
    });
  }
}
