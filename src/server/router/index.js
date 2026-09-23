import { normalizeRequest, result } from "../contracts.js";
import { routeImage } from "../adapters/image.js";
import { routeUnavailable } from "../adapters/unavailable.js";

const routes = Object.freeze({
  image: routeImage,
  edit: routeImage,
  video: routeUnavailable,
  audio: routeUnavailable
});

export async function routeGeneration(body) {
  const request = normalizeRequest(body);
  const handler = routes[request.mode];

  if (!handler) {
    const error = new Error("ROUTE_NOT_FOUND");
    error.statusCode = 400;
    throw error;
  }

  const output = await handler(request);

  return result({
    ...output,
    mode: request.mode,
    requestId: request.id
  });
}

export function routerStatus() {
  return {
    architecture: "router-adapters-providers",
    routes: {
      image: "image",
      edit: "image",
      video: "unavailable",
      audio: "unavailable"
    }
  };
}
