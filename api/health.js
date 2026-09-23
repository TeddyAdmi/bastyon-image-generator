export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, app: "Miya AI", version: "2.0.0-foundation", runtime: "vercel", architecture: "router-ready" });
}
