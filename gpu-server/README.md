# Miya LTX GPU Server

Separate GPU backend for Miya AI.

API:
- GET /health
- POST /generate
- GET /jobs/{jobId}
- GET /outputs/{jobId}/video.mp4

Default model: ltxv-2b-0.9.8-distilled.

Default test settings: 832x480, 121 frames, 24 FPS.

The official LTX-Video repository supports image-to-video conditioning.

## Cloud GPU

Clone the LTX-Video repository into /workspace/LTX-Video, install its inference dependencies, then install gpu-server/requirements.txt.

Set:
- PUBLIC_BASE_URL=https://YOUR-PUBLIC-LTX-URL

Run:
python3 app.py

The first generation downloads the model from Hugging Face. Keep the model cache on persistent storage.

## Miya Vercel

After the GPU server is publicly reachable, add this Vercel environment variable:

LTX_SERVER_URL=https://YOUR-PUBLIC-LTX-URL

The existing Miya /api/video route will then use LTX when this variable is present.

Do not put a Hugging Face token in the browser.

This backend intentionally serializes GPU generation with a single generation lock.
