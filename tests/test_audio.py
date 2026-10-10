import io
import wave

import numpy as np
import pytest

from backend.audio import AudioError, decode_audio


def wav_bytes(seconds=3, silent=False, channels=1, sample_rate=16000):
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    signal = np.zeros_like(t) if silent else .2 * np.sin(2 * np.pi * 200 * t)
    if channels == 2:
        signal = np.column_stack([signal, signal])
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes((signal * 32767).astype("<i2").tobytes())
    return buffer.getvalue()


@pytest.mark.parametrize("content,suffix,code", [
    (b"", ".wav", "empty_audio"),
    (b"bad", ".exe", "unsupported_format"),
    (b"not audio", ".wav", "decode_failed"),
    (wav_bytes(.5), ".wav", "audio_too_short"),
    (wav_bytes(silent=True), ".wav", "silent_audio"),
    (wav_bytes(181), ".wav", "audio_too_long"),
], ids=["empty", "unsupported", "corrupt", "short", "silent", "long"])
def test_invalid_audio(content, suffix, code):
    with pytest.raises(AudioError) as error:
        decode_audio(content, suffix)
    assert error.value.code == code


def test_real_decode_stereo_resamples_to_mono():
    waveform, duration = decode_audio(wav_bytes(channels=2, sample_rate=44100), ".wav")
    assert waveform.shape == (48000,)
    assert duration == 3
    assert np.isfinite(waveform).all()


def test_temp_file_deleted_on_failure(monkeypatch, tmp_path):
    import backend.audio as audio
    import tempfile
    original = tempfile.TemporaryDirectory
    monkeypatch.setattr(audio.tempfile, "TemporaryDirectory", lambda **kwargs: original(dir=tmp_path, **kwargs))
    with pytest.raises(AudioError):
        decode_audio(b"not an audio", ".wav")
    assert list(tmp_path.iterdir()) == []


def test_encoder_flush_tolerance_is_trimmed():
    waveform, duration = decode_audio(wav_bytes(180.2), ".wav")
    assert duration == 180
    assert len(waveform) == 180 * 16000


def test_temp_file_deleted_on_success(monkeypatch, tmp_path):
    import backend.audio as audio
    import tempfile
    original = tempfile.TemporaryDirectory
    monkeypatch.setattr(audio.tempfile, "TemporaryDirectory", lambda **kwargs: original(dir=tmp_path, **kwargs))
    decode_audio(wav_bytes(), ".wav")
    assert list(tmp_path.iterdir()) == []


def test_missing_explicit_decoder_is_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("FFMPEG_PATH", str(tmp_path / "missing-ffmpeg.exe"))
    with pytest.raises(AudioError) as error:
        decode_audio(wav_bytes(), ".wav")
    assert error.value.code == "decoder_unavailable"
    assert error.value.status == 503
