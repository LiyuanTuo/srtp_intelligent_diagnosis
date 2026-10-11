"""Bounded audio decoding. No filenames or recordings are logged."""
import os
import io
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import resampy

SAMPLE_RATE = 16000
MAX_SECONDS = 180
ENCODER_TOLERANCE = .5  # Browser encoders may flush a partial final frame.
MIN_SECONDS = 2  # Technical minimum, not a clinical recording protocol.
MAX_BYTES = 25 * 1024 * 1024
MAX_DECODE_BYTES = 128 * 1024 * 1024
PREPROCESSING_VERSION = "cfrafn-preprocess-v1"
ALLOWED_SUFFIXES = {".wav", ".webm", ".ogg", ".mp4", ".m4a", ".mp3", ".flac"}


class AudioError(Exception):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def ffmpeg_path():
    if os.environ.get("FFMPEG_PATH"):
        requested = os.environ["FFMPEG_PATH"]
        return str(Path(requested)) if Path(requested).is_file() else shutil.which(requested)
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return shutil.which("ffmpeg")


def decode_audio(content: bytes, suffix: str):
    if not content:
        raise AudioError("empty_audio", "文件为空，请重新录音或选择音频。")
    if len(content) > MAX_BYTES:
        raise AudioError("file_too_large", "音频不能超过 25 MB。", 413)
    if suffix.lower() not in ALLOWED_SUFFIXES:
        raise AudioError("unsupported_format", "请选择 WAV、WebM、OGG、MP4/M4A、MP3 或 FLAC 音频。", 415)
    executable = ffmpeg_path()
    if not executable:
        raise AudioError("decoder_unavailable", "音频解码服务不可用，请联系项目维护者。", 503)
    with tempfile.TemporaryDirectory(prefix="voice-analysis-") as folder:
        source = Path(folder) / ("input" + suffix.lower())
        decoded = Path(folder) / "decoded.wav"
        source.write_bytes(content)
        try:
            subprocess.run(
                [executable, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                 "-format_whitelist", "wav,matroska,webm,ogg,mov,mp3,flac",
                 "-i", str(source), "-map", "0:a:0", "-vn", "-t", str(MAX_SECONDS + 1),
                 "-c:a", "pcm_f32le", "-fs", str(MAX_DECODE_BYTES), str(decoded)],
                capture_output=True, timeout=30, check=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (subprocess.SubprocessError, OSError):
            raise AudioError("decode_failed", "无法读取该音频，请重新录音或换一个文件。") from None
        # Preserve native rate and channels: FFmpeg's default stereo downmix and
        # resampler differ from librosa's arithmetic mean + resampy recipe.
        if decoded.stat().st_size >= MAX_DECODE_BYTES:
            raise AudioError("decoded_audio_too_large", "解码后的音频过大，请选择常规采样率的单声道或双声道录音。")
        try:
            info = sf.info(decoded)
            if not 4000 <= info.samplerate <= 192000 or not 1 <= info.channels <= 8:
                raise AudioError("unsupported_audio_parameters", "音频采样率或声道数不受支持，请转换为常规 WAV 音频。")
            if info.duration > MAX_SECONDS + ENCODER_TOLERANCE:
                raise AudioError("audio_too_long", "音频超过 3 分钟，请截短后重试。")
            native, native_rate = sf.read(decoded, dtype="float32", always_2d=True)
        except (RuntimeError, ValueError):
            raise AudioError("decode_failed", "无法读取该音频，请重新录音或换一个文件。") from None
    mono = np.mean(native, axis=1)
    if not np.isfinite(mono).all():
        raise AudioError("invalid_audio", "音频包含无效采样值，请重新录制。")
    waveform = resampy.resample(mono, native_rate, SAMPLE_RATE, filter="kaiser_best")
    duration = len(waveform) / SAMPLE_RATE
    if duration > MAX_SECONDS + ENCODER_TOLERANCE:
        raise AudioError("audio_too_long", "音频超过 3 分钟，请截短后重试。")
    if duration > MAX_SECONDS:
        waveform = waveform[:MAX_SECONDS * SAMPLE_RATE]
        duration = MAX_SECONDS
    if duration < MIN_SECONDS:
        raise AudioError("audio_too_short", "音频不足 2 秒，请录制更长的声音。")
    if not np.isfinite(waveform).all():
        raise AudioError("invalid_audio", "音频包含无效采样值，请重新录制。")
    if np.max(np.abs(waveform)) < 1e-4 or np.sqrt(np.mean(waveform ** 2)) < 1e-5:
        raise AudioError("silent_audio", "未检测到有效声音，请检查麦克风后重录。")
    return waveform, duration


def prepare_model_audio(waveform):
    """User-supplied recipe, after mono/kaiser_best decoding; never mutate input.

    Reproduce the final PCM_16 WAV round trip in memory, since the upstream
    feature extraction reads those saved files rather than float waveforms.
    """
    import librosa

    values = np.asarray(waveform, dtype=np.float32)
    if values.ndim != 1 or values.size == 0 or not np.isfinite(values).all():
        raise AudioError("invalid_audio", "音频包含无效采样值，请重新录制。")
    peak = float(np.max(np.abs(values)))
    if peak < 1e-4 or float(np.sqrt(np.mean(values.astype(np.float64) ** 2))) < 1e-5:
        raise AudioError("silent_audio", "未检测到有效声音，请检查麦克风后重录。")
    normalized = values / peak
    trimmed, bounds = librosa.effects.trim(normalized, top_db=60, ref=np.max,
                                         frame_length=2048, hop_length=512)
    if len(trimmed) < MIN_SECONDS * SAMPLE_RATE:
        raise AudioError("audio_too_short", "去除首尾静音后音频不足 2 秒，请完整朗读后重录。")
    with io.BytesIO() as buffer:
        sf.write(buffer, trimmed, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        buffer.seek(0)
        processed, _ = sf.read(buffer, dtype="float32")
    return processed, {
        "version": PREPROCESSING_VERSION,
        "sample_rate": SAMPLE_RATE, "resampler": "resampy_kaiser_best",
        "normalization": "peak", "gain_db": round(float(-20 * np.log10(peak)), 3),
        "silence_top_db": 60, "output_subtype": "PCM_16",
        "input_duration_seconds": len(values) / SAMPLE_RATE,
        "processed_duration_seconds": len(processed) / SAMPLE_RATE,
        "trimmed_start_seconds": int(bounds[0]) / SAMPLE_RATE,
        "trimmed_end_seconds": (len(values) - int(bounds[1])) / SAMPLE_RATE,
    }
