export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const body = req.body || {};
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const ratio = typeof body.ratio === "string" ? body.ratio : "1:1";
  const mode = typeof body.mode === "string" ? body.mode : "image";

  if (!prompt) return res.status(400).json({ ok: false, error: "PROMPT_REQUIRED" });

  // Foundation contract only. Provider adapters will be connected through the router.
  return res.status(501).json({
    ok: false,
    error: "ROUTER_NOT_CONNECTED",
    app: "Miya AI",
    task: { type: mode, prompt, ratio }
  });
}
