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

  try {
    // Download the small Wan MP4 completely before responding.
    // This is intentionally buffered: Gradio temporary-file URLs can
    // behave poorly with browser Range/stream cancellation when proxied
    // directly through a serverless Web stream.
    const upstream = await fetch(source.toString(), {
      headers: {
        Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8"
      }
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return res.status(upstream.status).json({
        success: false,
        error: "Upstream video HTTP " + upstream.status,
        detail: detail.slice(0, 500)
      });
    }

    const contentType = upstream.headers.get("content-type") || "video/mp4";
    const buffer = Buffer.from(await upstream.arrayBuffer());

    if (!buffer.length) {
      return res.status(502).json({
        success: false,
        error: "Wan returned an empty video file"
      });
    }

    const total = buffer.length;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(total));

    if (req.method === "HEAD") {
      return res.status(200).end();
    }

    const range = String(req.headers.range || "").trim();

    if (!range) {
      res.statusCode = 200;
      return res.end(buffer);
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.statusCode = 416;
      res.setHeader("Content-Range", "bytes */" + total);
      return res.end();
    }

    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : total - 1;

    if (!match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        res.statusCode = 416;
        res.setHeader("Content-Range", "bytes */" + total);
        return res.end();
      }
      start = Math.max(0, total - suffixLength);
      end = total - 1;
    }

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start >= total
    ) {
      res.statusCode = 416;
      res.setHeader("Content-Range", "bytes */" + total);
      return res.end();
    }

    end = Math.min(end, total - 1);

    const chunk = buffer.subarray(start, end + 1);
    res.statusCode = 206;
    res.setHeader(
      "Content-Range",
      "bytes " + start + "-" + end + "/" + total
    );
    res.setHeader("Content-Length", String(chunk.length));

    return res.end(chunk);
  } catch (error) {
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
