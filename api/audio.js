import { Client } from "@gradio/client";

const AUDIO_SPACE = "stabilityai/stable-audio-3";

function extractAudioUrl(result) {
  const values = Array.isArray(result) ? result : [result];

  for (const value of values) {
    const candidates = [
      value?.url,
      value?.path,
      value?.audio?.url,
      value?.audio?.path,
      value?.data?.url,
      value?.data?.path
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return null;
}

async function generateAudio(prompt, duration) {
  const audioPrompt =
    "Sound effects only, no music, no singing, no speech. Realistic cinematic environmental audio matching this scene: " +
    String(prompt || "").trim();

  const token = String(process.env.HF_TOKEN || "").trim();

  const app = await Client.connect(
    AUDIO_SPACE,
    token ? { token } : undefined
  );

  const result = await app.predict("/infer", [
    "small-sfx",
    audioPrompt,
    Math.min(5, Math.max(1, Number(duration) || 5)),
    8,
    1.0,
    "pingpong",
    Math.floor(Math.random() * 2147483647)
  ]);

  const rawUrl = extractAudioUrl(result?.data);

  if (!rawUrl) {
    throw new Error(
      "Stable Audio 3 вернул ответ без WAV-файла: " +
      JSON.stringify(result?.data || result).slice(0, 1000)
    );
  }

  return /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : "https://stabilityai-stable-audio-3.hf.space/gradio_api/file=" +
      rawUrl.replace(/^\//, "");
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : (req.body || {});

    const prompt = String(body.prompt || "").trim();
    const duration = Math.min(5, Math.max(1, Number(body.duration) || 5));

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: "Пустой prompt для звука."
      });
    }

    const sourceUrl = await generateAudio(prompt, duration);
    const audioUrl =
      "/api/video-proxy?url=" + encodeURIComponent(sourceUrl);

    return res.status(200).json({
      success: true,
      audioUrl,
      model: "Stable Audio 3 Small SFX",
      provider: "Hugging Face ZeroGPU"
    });
  } catch (error) {
    console.error("Miya audio API:", error);

    return res.status(502).json({
      success: false,
      error:
        error?.message ||
        "Stable Audio 3 не смог создать звук.",
      code: "AUDIO_PROVIDER_ERROR"
    });
  }
}
