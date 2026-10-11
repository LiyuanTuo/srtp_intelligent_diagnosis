import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from starlette.concurrency import run_in_threadpool

from backend.audio import AudioError, MAX_BYTES, PREPROCESSING_VERSION, decode_audio, ffmpeg_path
from backend.inference import ROOT, VoiceModel
from backend.limits import UploadLimit
from backend.quality import assess_quality

logger = logging.getLogger("voice")
engine = VoiceModel()


@asynccontextmanager
async def lifespan(app):
    await run_in_threadpool(engine.load)
    if not engine.ready:
        logger.error("Model initialization failed: %s", engine.error)
        raise RuntimeError(f"Model initialization failed: {engine.error}")
    try:
        yield
    finally:
        engine.close()


app = FastAPI(title="SRTP 声音评估研究演示", lifespan=lifespan)
app.add_middleware(UploadLimit)


@app.middleware("http")
async def privacy_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    return JSONResponse({"error": {"code": "invalid_request", "message": "请提交一个音频文件，并确认本次处理授权。"}}, status_code=422)


@app.exception_handler(AudioError)
async def audio_error(request, exc):
    return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)


@app.get("/api/health")
def health():
    ready = engine.ready and bool(ffmpeg_path())
    return {
        "status": "ready" if ready else "unavailable",
        "model_ready": engine.ready,
        "decoder_ready": bool(ffmpeg_path()),
        "model_version": engine.version,
        "preprocessing_version": PREPROCESSING_VERSION,
        "classification_verified": False,
        "message": "研究模型已就绪；类别解释待确认。" if ready else "服务未就绪，请检查模型依赖、权重及 FFmpeg。",
        "limits": {"max_seconds": 180, "min_seconds": 2, "max_bytes": MAX_BYTES},
    }


@app.get("/api/ready", include_in_schema=False)
def readiness():
    ready = engine.ready and bool(ffmpeg_path())
    return JSONResponse({"status": "ready" if ready else "unavailable"},
                        status_code=200 if ready else 503)


def analyze_sync(content, suffix):
    if not engine.ready:
        raise AudioError("model_unavailable", "模型尚未就绪，请稍后重试或联系项目维护者。", 503)
    if not engine.lock.acquire(blocking=False):
        raise AudioError("service_busy", "服务正在处理另一段音频，请稍后重试。", 429)
    started = time.perf_counter()
    try:
        waveform, duration = decode_audio(content, suffix)
        quality = assess_quality(waveform)
        result = engine.predict(waveform)
        result["audio_quality"] = quality
        result.update(audio_duration_seconds=round(duration, 3), analysis_seconds=round(time.perf_counter() - started, 3))
        return result
    except AudioError:
        raise
    except Exception:
        logger.exception("Audio analysis failed")
        raise AudioError("analysis_failed", "分析未完成，请重试；若持续失败请联系项目维护者。", 503) from None
    finally:
        engine.lock.release()


@app.post("/api/voice/analyze")
async def analyze(audio: UploadFile = File(...), consent: bool = Form(...)):
    try:
        if not consent:
            raise AudioError("consent_required", "请先确认录音用途并授权本次处理。", 400)
        content = await audio.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise AudioError("file_too_large", "音频不能超过 25 MB。", 413)
        return await run_in_threadpool(analyze_sync, content, Path(audio.filename or "").suffix.lower())
    finally:
        await audio.close()


app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
