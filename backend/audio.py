"""Bounded audio decoding. No filenames or recordings are logged."""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
MAX_SECONDS = 180
ENCODER_TOLERANCE = .5  # Browser encoders may flush a partial final frame.
MIN_SECONDS = 2  # Technical minimum, not a clinical recording protocol.
MAX_BYTES = 25 * 1024 * 1024
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
        source.write_bytes(content)
        try:
            completed = subprocess.run(
                [executable, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                 "-format_whitelist", "wav,matroska,webm,ogg,mov,mp3,flac",
                 "-i", str(source), "-map", "0:a:0", "-vn", "-t", str(MAX_SECONDS + 1),
                 "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
                capture_output=True, timeout=30, check=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (subprocess.SubprocessError, OSError):
            raise AudioError("decode_failed", "无法读取该音频，请重新录音或换一个文件。") from None
    waveform = np.frombuffer(completed.stdout, dtype="<f4").copy()
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
