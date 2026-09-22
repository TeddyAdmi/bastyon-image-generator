import apiHandler from "../../api/video.js";
import { runVercelHandler } from "./_vercel-adapter.js";

export default async function handler(request) {
  const url = new URL(request.url);

  const bodyText = request.method === "GET"
    ? null
    : await request.text();

  const event = {
    httpMethod: request.method,
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body: bodyText,
    isBase64Encoded: false
  };

  const result = await runVercelHandler(apiHandler, event);

  const headers = new Headers(result.headers || {});
  headers.set("Cache-Control", "no-store");

  if (result.isBase64Encoded) {
    const bytes = Buffer.from(result.body || "", "base64");
    return new Response(bytes, {
      status: result.statusCode || 200,
      headers
    });
  }

  return new Response(result.body || "", {
    status: result.statusCode || 200,
    headers
  });
}
