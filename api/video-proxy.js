export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
  res.setHeader("Cache-Control", "public, max-age=60");

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const raw = String(req.query?.url || "");
    if (!raw) return res.status(400).json({ success: false, error: "Missing url" });

    const source = new URL(raw);
    if (!source.hostname.endsWith(".hf.space")) {
      return res.status(403).json({ success: false, error: "Video source is not allowed" });
    }

    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(source.toString(), { headers });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ success: false, error: "Upstream video HTTP " + upstream.status });
    }

    res.statusCode = upstream.status;
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    if (req.method === "HEAD" || !upstream.body) return res.end();

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    console.error("Miya video proxy:", error);
    if (!res.headersSent) {
      return res.status(502).json({
        success: false,
        error: error?.message || "Video proxy error"
      });
    }
    res.end();
  }
}
