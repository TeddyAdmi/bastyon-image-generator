import base64
import os
import secrets
import subprocess
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

ROOT = Path("/workspace/gpu-server")
WORK_DIR = ROOT / "jobs"
OUTPUT_DIR = ROOT / "outputs"
WORK_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

LTX_DIR = Path("/workspace/LTX-Video")
CONFIG = os.getenv("LTX_CONFIG", "configs/ltxv-2b-0.9.8-distilled.yaml")
WIDTH = int(os.getenv("LTX_WIDTH", "832"))
HEIGHT = int(os.getenv("LTX_HEIGHT", "480"))
FRAMES = int(os.getenv("LTX_FRAMES", "121"))
FPS = int(os.getenv("LTX_FPS", "24"))
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
MAX_QUEUE = int(os.getenv("MAX_QUEUE", "3"))

app = FastAPI(title="Miya LTX Video Server", version="1.0.0")
jobs = {}
queue_lock = threading.Lock()
generation_lock = threading.Lock()


class GenerateRequest(BaseModel):
    imageBase64: str
    prompt: str
    seed: int | None = None


def decode_data_url(value: str, destination: Path):
    if not value.startswith("data:image/"):
        raise ValueError("imageBase64 must be a data:image/...;base64,... URL")
    try:
        header, encoded = value.split(",", 1)
    except ValueError as exc:
        raise ValueError("Invalid image data URL") from exc
    mime = header.split(";", 1)[0].lower()
    extension = {
        "data:image/png": ".png",
        "data:image/jpeg": ".jpg",
        "data:image/webp": ".webp",
    }.get(mime, ".png")
    destination = destination.with_suffix(extension)
    destination.write_bytes(base64.b64decode(encoded))
    return destination


def run_generation(job_id: str, image_path: Path, prompt: str, seed: int):
    job = jobs[job_id]
    output_dir = OUTPUT_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    job["status"] = "running"
    job["startedAt"] = time.time()

    command = [
        "python3",
        str(LTX_DIR / "inference.py"),
        "--prompt", prompt,
        "--conditioning_media_paths", str(image_path),
        "--conditioning_start_frames", "0",
        "--height", str(HEIGHT),
        "--width", str(WIDTH),
        "--num_frames", str(FRAMES),
        "--frame_rate", str(FPS),
        "--seed", str(seed),
        "--pipeline_config", CONFIG,
        "--output_path", str(output_dir),
        "--offload_to_cpu",
    ]

    try:
        with generation_lock:
            process = subprocess.run(
                command,
                cwd=str(LTX_DIR),
                capture_output=True,
                text=True,
                timeout=30 * 60,
            )

        log = (process.stdout or "") + "\n" + (process.stderr or "")
        (output_dir / "generation.log").write_text(log, encoding="utf-8")

        if process.returncode != 0:
            raise RuntimeError("LTX inference failed. Check generation.log.")

        candidates = sorted(output_dir.glob("*.mp4"))
        if not candidates:
            raise RuntimeError("LTX finished without producing an MP4.")

        generated = candidates[-1]
        output_path = output_dir / "video.mp4"
        if generated != output_path:
            generated.replace(output_path)

        job["status"] = "done"
        job["videoUrl"] = (
            f"{PUBLIC_BASE_URL}/outputs/{job_id}/video.mp4"
            if PUBLIC_BASE_URL
            else f"/outputs/{job_id}/video.mp4"
        )
        job["finishedAt"] = time.time()

    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)
        job["finishedAt"] = time.time()


def start_job(job_id: str, image_path: Path, prompt: str, seed: int):
    thread = threading.Thread(
        target=run_generation,
        args=(job_id, image_path, prompt, seed),
        daemon=True,
    )
    thread.start()


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "miya-ltx",
        "model": "ltxv-2b-0.9.8-distilled",
        "width": WIDTH,
        "height": HEIGHT,
        "frames": FRAMES,
        "fps": FPS,
    }


@app.post("/generate")
def generate(payload: GenerateRequest):
    prompt = payload.prompt.strip()
    if not payload.imageBase64:
        raise HTTPException(400, "imageBase64 is required")
    if not prompt:
        raise HTTPException(400, "prompt is required")

    with queue_lock:
        active = sum(
            1 for job in jobs.values()
            if job["status"] in ("queued", "running")
        )
        if active >= MAX_QUEUE:
            raise HTTPException(429, "LTX server queue is full. Try again shortly.")

        job_id = secrets.token_urlsafe(12)
        job_dir = WORK_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        image_path = decode_data_url(payload.imageBase64, job_dir / "input.png")
        seed = (
            int(payload.seed)
            if payload.seed is not None
            else secrets.randbelow(2_147_483_647)
        )
        jobs[job_id] = {
            "status": "queued",
            "createdAt": time.time(),
            "seed": seed,
        }

    start_job(job_id, image_path, prompt, seed)

    return {
        "success": True,
        "jobId": job_id,
        "status": "queued",
        "provider": "LTX-Video",
        "model": "ltxv-2b-0.9.8-distilled",
        "duration": FRAMES / FPS,
    }


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    if job["status"] == "done":
        return {
            "success": True,
            "done": True,
            "status": "SUCCEEDED",
            "videoUrl": job["videoUrl"],
            "provider": "LTX-Video",
            "model": "ltxv-2b-0.9.8-distilled",
        }

    if job["status"] == "error":
        return {
            "success": False,
            "done": True,
            "status": "FAILED",
            "error": job.get("error", "LTX generation failed"),
        }

    return {
        "success": True,
        "done": False,
        "status": job["status"].upper(),
        "provider": "LTX-Video",
        "model": "ltxv-2b-0.9.8-distilled",
    }


@app.get("/outputs/{job_id}/video.mp4")
def output_video(job_id: str):
    path = OUTPUT_DIR / job_id / "video.mp4"
    if not path.exists():
        raise HTTPException(404, "Video not ready")
    return FileResponse(path, media_type="video/mp4", filename="miya.mp4")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
