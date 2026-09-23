import { routerStatus, providersStatus } from "../src/server/index.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    app: "Miya AI",
    version: "2.1.0-router",
    runtime: "vercel",
    ...routerStatus(),
    providers: providersStatus()
  });
}
