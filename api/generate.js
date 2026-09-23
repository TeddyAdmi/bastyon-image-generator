import { routeGeneration } from "../src/server/index.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const output = await routeGeneration(body);
    return res.status(200).json(output);
  } catch (error) {
    console.error("Miya router:", error);
    const status = Number(error?.statusCode) || 500;
    return res.status(status).json({
      ok: false,
      error: error?.message || "ROUTER_ERROR"
    });
  }
}
