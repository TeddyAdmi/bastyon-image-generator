const AUDIO_SPACE = "https://stabilityai-stable-audio-3.hf.space";
const AUDIO_API = AUDIO_SPACE + "/gradio_api";

function authHeaders() {
  const token = String(process.env.HF_TOKEN || "").trim();
  return token ? { Authorization: "Bearer " + token } : {};
}

async function generateAudio(prompt, duration) {
  const audioPrompt =
    "Sound effects only, no music, no singing, no speech. Realistic cinematic environmental audio matching this scene: " +
    String(prompt || "").trim();

  const response = await fetch(AUDIO_API + "/call/infer", {
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
      ]
    })
  });

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok || !payload?.event_id) {
    throw new Error(
      "Stable Audio 3 call HTTP " + response.status + ": " +
      (payload?.error || payload?.message || text || "no event_id")
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const poll = await fetch(
      AUDIO_API + "/call/infer/" + encodeURIComponent(payload.event_id),
      {
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: controller.signal
      }
    );

    if (!poll.ok) throw new Error("Stable Audio 3 polling HTTP " + poll.status);

    const body = await poll.text();
    let event = "";
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

      if (event === "error" || event === "unexpected_error") {
        const message =
          typeof data === "string"
            ? data
            : data?.error || data?.message || data?.detail || JSON.stringify(data);
        throw new Error("Stable Audio 3 Gradio error: " + message);
      }

      if (event === "complete" || event === "process_completed" || event === "data") {
        const first = Array.isArray(data) ? data[0] : data;
        const url =
          first?.url ||
          first?.path ||
          first?.audio?.url ||
          first?.audio?.path ||
          first?.data?.url ||
          first?.data?.path;

        if (!url) continue;

        return /^https?:\/\//i.test(String(url))
          ? String(url)
          : AUDIO_SPACE + "/gradio_api/file=" + String(url).replace(/^\//, "");
      }
    }

    throw new Error(
      "Stable Audio 3 завершил запрос без готового аудио. " +
      (events.length ? "События: " + events.join(", ") : "SSE-события не получены")
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
