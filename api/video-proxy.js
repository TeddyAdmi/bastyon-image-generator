import { Readable } from "node:stream";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, Last-Modified"
  );
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const raw = String(req.query?.url || "");
  if (!raw) {
    return res.status(400).json({ success: false, error: "Missing url" });
  }

  let source;
  try {
    source = new URL(raw);
  } catch {
    return res.status(400).json({ success: false, error: "Invalid video url" });
  }

  if (!source.hostname.endsWith(".hf.space")) {
    return res.status(403).json({ success: false, error: "Video source is not allowed" });
  }

  const controller = new AbortController();
  let clientClosed = false;

  const closeUpstream = () => {
    if (!res.writableEnded) {
      clientClosed = true;
      controller.abort();
    }
  };

  req.once("aborted", closeUpstream);
  res.once("close", () => {
    if (!res.writableEnded) closeUpstream();
  });

  try {
    const headers = {
      Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8"
    };

    if (req.headers.range) {
      headers.Range = String(req.headers.range);
    }

    const upstream = await fetch(source.toString(), {
      method: req.method,
      headers,
      signal: controller.signal
    });

    if (!upstream.ok && upstream.status !== 206) {
      const detail = await upstream.text().catch(() => "");
      return res.status(upstream.status).json({
        success: false,
        error: "Upstream video HTTP " + upstream.status,
        detail: detail.slice(0, 500)
      });
    }

    res.statusCode = upstream.status;

    const contentType = upstream.headers.get("content-type") || "video/mp4";
    res.setHeader("Content-Type", contentType);

    for (const name of [
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified"
    ]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    // Firefox/HTMLVideoElement relies on byte ranges for seeking and
    // incremental playback. Keep the upstream 206 response intact.
    if (!res.getHeader("Accept-Ranges")) {
      res.setHeader("Accept-Ranges", "bytes");
    }

    if (req.method === "HEAD" || !upstream.body) {
      return res.end();
    }

    // Let Node stream the Web Readable directly to the HTTP response.
    // This avoids buffering the MP4 in memory and handles backpressure.
    const stream = Readable.fromWeb(upstream.body);

    stream.on("error", (error) => {
      if (!clientClosed && !res.headersSent) {
        res.status(502).json({
          success: false,
          error: error?.message || "Video stream error"
        });
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });

    stream.pipe(res);
  } catch (error) {
    if (error?.name === "AbortError" && clientClosed) {
      return;
    }

    console.error("Miya video proxy:", error);

    if (!res.headersSent) {
      return res.status(502).json({
        success: false,
        error: error?.message || "Video proxy error"
      });
    }

    if (!res.writableEnded) res.end();
  }
}
