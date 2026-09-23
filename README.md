# Miya AI

Miya AI is built around a strict provider-independent generation architecture.

## Server architecture

```
Vercel API
   │
   ▼
Router
   │
   ├── Adapters
   │      ├── image
   │      ├── edit
   │      ├── video
   │      └── audio
   │
   ▼
Providers
   ├── image/vheer
   ├── image/*
   ├── video/*
   └── audio/*
```

### Rules

1. `api/*.js` contains only thin Vercel handlers.
2. The router owns task validation and routing.
3. Adapters translate Miya's canonical contract into provider calls.
4. Providers own external API details, URLs, authentication and response normalization.
5. The frontend never knows provider URLs or provider-specific payloads.
6. Adding or replacing a provider must not require changing the UI.
7. Large media must not be proxied through Vercel as base64 when a URL/job contract can be used.
8. Video/audio providers are intentionally disconnected until their contracts are verified.

## Image provider configuration

The Vheer adapter is isolated in:

`src/server/providers/image/vheer.js`

It is enabled only when:

`MIYA_VHEER_URL`

is present in Vercel environment variables.

The adapter expects:

- `POST /tti` for text-to-image
- `POST /pti` for image-to-image

This assumption is isolated to one file. If the provider contract changes, replace only that provider module.

## API contract

`POST /api/generate`

Example:

```json
{
  "mode": "image",
  "prompt": "cinematic realistic portrait",
  "ratio": "9:16"
}
```

The API returns a canonical result:

```json
{
  "ok": true,
  "mode": "image",
  "status": "completed",
  "provider": "vheer",
  "model": "Flux Dev",
  "imageUrl": "https://...",
  "requestId": null,
  "meta": {}
}
```

For unconfigured providers the API returns HTTP 503 instead of hiding the failure behind a fake success response.
