function makeResponse() {
  const state = { statusCode: 200, headers: {}, body: null, ended: false };

  const res = {
    get statusCode() { return state.statusCode; },
    set statusCode(v) { state.statusCode = Number(v) || 200; },
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) { state.headers[name] = String(value); },
    getHeader(name) { return state.headers[name]; },
    status(code) { state.statusCode = Number(code) || 200; return res; },
    json(value) {
      state.headers["Content-Type"] ||= "application/json; charset=utf-8";
      state.body = JSON.stringify(value);
      res.headersSent = true;
      state.ended = true;
      res.writableEnded = true;
      return res;
    },
    end(value = "") {
      state.body = value;
      res.headersSent = true;
      state.ended = true;
      res.writableEnded = true;
      return res;
    },
    write(value) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
      const previous = Buffer.isBuffer(state.body) ? state.body : Buffer.from(state.body || "");
      state.body = Buffer.concat([previous, chunk]);
      res.headersSent = true;
      return true;
    }
  };

  return { state, res };
}

function makeRequest(event) {
  let body = event.body ?? null;

  if (body && event.isBase64Encoded) {
    body = Buffer.from(body, "base64").toString("utf8");
  }

  if (typeof body === "string") {
    const contentType = String(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "").toLowerCase();
    if (contentType.includes("application/json")) {
      try {
        body = JSON.parse(body);
      } catch {
        // Leave the raw body intact so the original handler can report a useful error.
      }
    }
  }

  const query = event.queryStringParameters || {};
  const path = event.path || "/";
  const queryString = new URLSearchParams(query).toString();

  return {
    method: event.httpMethod || event.requestContext?.http?.method || "GET",
    headers: event.headers || {},
    query,
    body,
    url: queryString ? path + "?" + queryString : path
  };
}

export async function runVercelHandler(handler, event) {
  const req = makeRequest(event);
  const { state, res } = makeResponse();

  try {
    await handler(req, res);
  } catch (error) {
    if (!state.ended) {
      state.statusCode = 500;
      state.headers["Content-Type"] = "application/json; charset=utf-8";
      state.body = JSON.stringify({
        success: false,
        error: error?.message || "Internal server error"
      });
    }
  }

  const raw = state.body ?? "";
  const isBuffer = Buffer.isBuffer(raw);

  return {
    statusCode: state.statusCode || 200,
    headers: state.headers,
    body: isBuffer ? raw.toString("base64") : String(raw),
    isBase64Encoded: isBuffer
  };
}
