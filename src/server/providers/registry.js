import * as vheer from "./image/vheer.js";

const imageProviders = Object.freeze({
  vheer
});

export function getImageProvider(name) {
  return imageProviders[String(name || "").toLowerCase()] || null;
}

export function providersStatus() {
  return {
    image: Object.fromEntries(
      Object.entries(imageProviders).map(([name, provider]) => [
        name,
        {
          enabled: provider.enabled(),
          model: provider.model
        }
      ])
    ),
    video: {},
    audio: {}
  };
}
