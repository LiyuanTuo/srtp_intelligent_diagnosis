import numpy as np
import pytest
from backend.quality import assess_quality
from backend.audio import SAMPLE_RATE


def tone(amplitude=.1, seconds=3):
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def codes(report):
    return {issue["code"] for issue in report["issues"]}


def test_typical_level_has_no_advisory_and_does_not_mutate_audio():
    signal = tone(); original = signal.copy()
    quality = assess_quality(signal)
    assert quality["issues"] == []
    assert quality["rms_dbfs"] == pytest.approx(-23, abs=.2)
    np.testing.assert_array_equal(signal, original)


def test_low_volume_produces_actionable_advisory():
    assert "low_volume" in codes(assess_quality(tone(.001)))


def test_clipping_is_detected_without_changing_samples():
    signal = np.clip(tone(2), -.999, .999)
    assert "possible_clipping" in codes(assess_quality(signal))


def test_long_quiet_sections_are_reported():
    signal = np.concatenate([tone(seconds=1), np.zeros(SAMPLE_RATE * 3, dtype=np.float32)])
    quality = assess_quality(signal)
    assert quality["quiet_frame_ratio"] == pytest.approx(.75)
    assert "many_quiet_frames" in codes(quality)


def test_zero_signal_metrics_are_finite_even_though_decoder_rejects_silence():
    quality = assess_quality(np.zeros(SAMPLE_RATE, dtype=np.float32))
    assert np.isfinite(quality["rms_dbfs"])
    assert "low_volume" in codes(quality)
