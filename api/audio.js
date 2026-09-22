const AUDIO_SPACE = "https://stabilityai-stable-audio-3.hf.space";
const AUDIO_API = AUDIO_SPACE + "/gradio_api";

function authHeaders() {
  const token = String(process.env.HF_TOKEN || "").trim();
  return token ? { Authorization: "Bearer " + token } : {};
}

function extractAudioUrl(data) {
  const values = Array.isArray(data) ? data : [data];

  for (const value of values) {
    const candidates = [
      value?.url,
      value?.path,
      value?.audio?.url,
      value?.audio?.path,
      value?.data?.url,
      value?.data?.path,
      value?.data?.[0]?.url,
      value?.data?.[0]?.path
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        const raw = candidate.trim();
        return /^https?:\/\//i.test(raw)
          ? raw
          : AUDIO_SPACE + "/gradio_api/file=" + raw.replace(/^\//, "");
      }
    }
  }

  return null;
}

async function generateAudio(prompt, duration) {
  const audioPrompt =
    "Sound effects only, no music, no singing, no speech. Realistic cinematic environmental audio matching this scene: " +
    String(prompt || "").trim();

  // Stable Audio 3 currently exposes /infer through Gradio's queue API.
  // The public Space examples use fn_index 3 for the Simple /infer endpoint.
  const sessionHash =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now();

  const joinResponse = await fetch(AUDIO_API + "/queue/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      data: [
        "small-sfx",
        audioPrompt,
        Math.min(5, Math.max(1, Number(duration) || 5)),
        8,
        1.0,
        "pingpong",
        Math.floor(Math.random() * 2147483647)
      ],
      fn_index: 3,
      session_hash: sessionHash
    })
  });

  const joinText = await joinResponse.text();
  let joinPayload = null;
  try { joinPayload = joinText ? JSON.parse(joinText) : null; } catch {}

  if (!joinResponse.ok) {
    throw new Error(
      "Stable Audio 3 queue/join HTTP " + joinResponse.status + ": " +
      (joinPayload?.error || joinPayload?.message || joinText || "unknown error")
    );
  }

  if (joinPayload?.error) {
    throw new Error("Stable Audio 3 queue error: " + joinPayload.error);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const poll = await fetch(
      AUDIO_API + "/queue/data?session_hash=" + encodeURIComponent(sessionHash),
      {
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: controller.signal
      }
    );

    if (!poll.ok) {
      const errorText = await poll.text().catch(() => "");
      throw new Error(
        "Stable Audio 3 queue/data HTTP " + poll.status +
        (errorText ? ": " + errorText.slice(0, 500) : "")
      );
    }

    const body = await poll.text();
    let event = "";
    let lastData = null;
    const events = [];

    for (const line of body.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        events.push(event);
        continue;
      }

      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "null") continue;

      let data;
      try { data = JSON.parse(raw); } catch { data = raw; }
      lastData = data;

      if (event === "queue_full") {
        throw new Error("Stable Audio 3 сейчас перегружен: очередь ZeroGPU заполнена.");
      }

      if (event === "error" || event === "unexpected_error") {
        const message =
          typeof data === "string"
            ? data
            : data?.error ||
              data?.message ||
              data?.detail ||
              data?.msg ||
              JSON.stringify(data);
        throw new Error("Stable Audio 3 Gradio error: " + message);
      }

      if (event === "process_completed" || event === "complete" || event === "data") {
        const url = extractAudioUrl(data);
        if (url) return url;

        if (event === "process_completed") {
          throw new Error(
            "Stable Audio 3 завершил генерацию, но не вернул WAV/аудиофайл. Данные: " +
            JSON.stringify(data).slice(0, 800)
          );
        }
      }
    }

    throw new Error(
      "Stable Audio 3 не вернул готовый звук. " +
      (events.length ? "События: " + events.join(", ") : "SSE-события не получены") +
      (lastData ? " Последние данные: " + JSON.stringify(lastData).slice(0, 700) : "")
    );
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = String(body.prompt || "").trim();
    const duration = Math.min(5, Math.max(1, Number(body.duration) || 5));

    if (!prompt) {
      return res.status(400).json({ success: false, error: "Пустой prompt для звука." });
    }

    const sourceUrl = await generateAudio(prompt, duration);
    const audioUrl = "/api/video-proxy?url=" + encodeURIComponent(sourceUrl);

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
      error: error?.message || "Stable Audio 3 не смог создать звук.",
      code: "AUDIO_PROVIDER_ERROR"
    });
  }
}
