# Miya AI

Miya AI is an image, video and audio studio designed for Web, Mobile Web and Bastyon Mini Apps.

## Architecture

Browser / Bastyon -> Miya UI -> API Gateway / Router -> Task Router -> Image / Video / Audio providers -> Post-process -> Result URL.

The frontend is provider-agnostic. AI providers are adapters, not UI components.

Principles:
- keep the frontend lightweight;
- never put provider secrets in client code;
- avoid sending large video payloads through Vercel Functions;
- treat every AI Space/provider as a separate adapter;
- add fallbacks at the router layer;
- keep Bastyon integration isolated in src/bastyon.js;
- keep UI state isolated from providers.

Current stage: foundation only. Providers are intentionally not wired yet.

Deployment: GitHub main -> Vercel Production. Bastyon loads the Vercel production URL through b_manifest.json.
