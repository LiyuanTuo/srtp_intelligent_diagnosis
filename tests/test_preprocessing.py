"""Parity with the supplied preprocessing recipe, using synthetic audio only."""
import io

import librosa
import numpy as np
import pytest
import resampy
import soundfile as sf

from backend.audio import AudioError, SAMPLE_RATE, decode_audio, prepare_model_audio


def wav(signal, rate=16000):
    buf = io.BytesIO()
    sf.write(buf, signal, rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def tone(seconds=3, amplitude=.1, rate=16000):
    t = np.arange(int(rate * seconds)) / rate
    return (amplitude * np.sin(2 * np.pi * 213 * t)).astype(np.float32)


def reference(content):
    # Standalone steps from the supplied script, using a PCM WAV fixture so its
    # initial AudioSegment WAV export is lossless and requires no pydub import.
    signal, rate = librosa.load(io.BytesIO(content), sr=None, mono=True)
    signal = resampy.resample(signal, rate, 16000)
    signal /= max(abs(signal))
    signal, _ = librosa.effects.trim(signal)
    return sf.read(io.BytesIO(wav(signal)), dtype="float32")[0]


@pytest.mark.parametrize("rate", [16000, 44100, 48000])
def test_stereo_recipe_parity_including_pcm_output(rate):
    # Unequal channels catch FFmpeg's different default stereo mixing gains.
    left = np.concatenate([np.zeros(rate), tone(rate=rate), np.zeros(rate)])
    right = left * .4 + np.concatenate([np.zeros(rate), tone(amplitude=.02, rate=rate), np.zeros(rate)])
    content = wav(np.stack([left, right], axis=1), rate)
    decoded, duration = decode_audio(content, ".wav")
    original = decoded.copy()
    processed, metadata = prepare_model_audio(decoded)
    np.testing.assert_array_equal(processed, reference(content))
    np.testing.assert_array_equal(decoded, original)
    assert duration == 5
    assert metadata["trimmed_start_seconds"] > .8
    assert metadata["trimmed_end_seconds"] > .8
    assert metadata["output_subtype"] == "PCM_16"


def test_gain_invariance_without_removing_internal_pause():
    original = np.concatenate([np.zeros(16000), tone(), np.zeros(16000), tone(), np.zeros(16000)]).astype(np.float32)
    loud, metadata = prepare_model_audio(original)
    quiet, quiet_meta = prepare_model_audio(original * .1)
    np.testing.assert_allclose(loud, quiet, atol=1 / 32768, rtol=0)
    assert metadata["processed_duration_seconds"] > 7  # middle pause retained
    assert metadata["processed_duration_seconds"] < 8
    assert quiet_meta["gain_db"] - metadata["gain_db"] == pytest.approx(20, abs=.002)
    assert len(loud) == len(quiet)


@pytest.mark.parametrize("signal,code", [
    (np.zeros(48000), "silent_audio"),
    (np.full(48000, 1e-8), "silent_audio"),
    (np.full(48000, np.nan), "invalid_audio"),
    (np.full(48000, np.inf), "invalid_audio"),
    (np.array([]), "invalid_audio"),
    (np.concatenate([np.zeros(16000), tone(.2), np.zeros(32000)]), "audio_too_short"),
])
def test_invalid_or_short_trimmed_audio(signal, code):
    with pytest.raises(AudioError) as exc:
        prepare_model_audio(signal)
    assert exc.value.code == code


def test_preprocessing_does_not_mask_low_volume_quality():
    from backend.quality import assess_quality
    quiet = tone(amplitude=.001)
    before = quiet.copy()
    processed, _ = prepare_model_audio(quiet)
    assert np.max(np.abs(processed)) >= .9999
    assert "low_volume" in [issue["code"] for issue in assess_quality(quiet)["issues"]]
    np.testing.assert_array_equal(quiet, before)


def test_decode_native_size_limit_and_cleanup(monkeypatch, tmp_path):
    import backend.audio as audio
    import tempfile
    factory = tempfile.TemporaryDirectory
    monkeypatch.setattr(audio.tempfile, "TemporaryDirectory", lambda **kw: factory(dir=tmp_path, **kw))
    monkeypatch.setattr(audio, "MAX_DECODE_BYTES", 4096)
    with pytest.raises(AudioError) as exc:
        decode_audio(wav(tone()), ".wav")
    assert exc.value.code == "decoded_audio_too_large"
    assert list(tmp_path.iterdir()) == []
