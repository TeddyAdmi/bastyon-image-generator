export async function routeUnavailable(request) {
  const error = new Error(
    "PROVIDER_NOT_CONNECTED:" + String(request.mode || "unknown")
  );
  error.statusCode = 503;
  throw error;
}
