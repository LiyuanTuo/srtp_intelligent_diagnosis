"""Opt-in integration tests using real weights and CC-BY LibriSpeech audio."""
import os
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import app as module
from backend.audio import decode_audio, ffmpeg_path

pytestmark = pytest.mark.skipif(os.environ.get("RUN_MODEL_TESTS") != "1", reason="Set RUN_MODEL_TESTS=1 after downloading the authorized sample")
SAMPLE = Path(__file__).resolve().parents[1] / ".cache" / "libri1.ogg"


@pytest.fixture(scope="module")
def real_client():
    assert SAMPLE.exists(), "Download the authorized sample using README instructions"
    with TestClient(module.app) as client:
        assert module.engine.ready, module.engine.error
        yield client


def test_real_model_strict_load_and_repeatability(real_client):
    waveform, duration = decode_audio(SAMPLE.read_bytes(), ".ogg")
    scores = [module.engine.predict(waveform)["score"] for _ in range(2)]
    assert scores[0] == scores[1]
    assert 0 <= scores[0] <= 1
    assert module.engine.audit["strict_load"] is True
    assert module.engine.audit["architecture"]["transformed_feature_dim"] == 196
    assert module.engine.audit["feature_order_matches_selected_list"] is False
    assert module.engine.audit["preprocessing"] == "cfrafn-preprocess-v1"


@pytest.mark.parametrize("extension,codec", [("wav", "pcm_s16le"), ("webm", "libopus"), ("m4a", "aac"), ("mp3", "libmp3lame"), ("flac", "flac")])
def test_real_http_audio_formats(real_client, tmp_path, extension, codec):
    target = tmp_path / ("sample." + extension)
    subprocess.run([ffmpeg_path(), "-nostdin", "-v", "error", "-i", str(SAMPLE), "-c:a", codec, str(target)], check=True, capture_output=True)
    response = real_client.post("/api/voice/analyze", data={"consent": "true"}, files={"audio": (target.name, target.read_bytes(), "application/octet-stream")})
    assert response.status_code == 200, response.text
    result = response.json()
    assert 0 <= result["score"] <= 1
    assert result["classification"] is None
    assert result["classification_verified"] is False
    assert 14 < result["audio_duration_seconds"] < 16
    assert result["analysis_seconds"] > 0
    assert isinstance(result["audio_quality"]["issues"], list)
    assert "disclaimer" in result["audio_quality"]
    assert result["preprocessing"]["version"] == "cfrafn-preprocess-v1"
    assert 2 <= result["preprocessing"]["processed_duration_seconds"] <= result["audio_duration_seconds"] + .001


def test_real_model_gain_invariance(real_client):
    waveform, _ = decode_audio(SAMPLE.read_bytes(), ".ogg")
    original = module.engine.predict(waveform)["score"]
    quiet = module.engine.predict(waveform * .1)["score"]
    assert abs(original - quiet) < .001


def test_http_retains_raw_quality_after_normalization(real_client):
    import io
    import numpy as np
    import soundfile as sf
    t = np.arange(48000) / 16000
    quiet = (.001 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    buffer = io.BytesIO()
    sf.write(buffer, quiet, 16000, format="WAV", subtype="FLOAT")
    response = real_client.post("/api/voice/analyze", data={"consent": "true"},
                               files={"audio": ("quiet.wav", buffer.getvalue(), "audio/wav")})
    assert response.status_code == 200
    result = response.json()
    assert result["preprocessing"]["gain_db"] == pytest.approx(60, abs=.01)
    assert result["audio_quality"]["rms_dbfs"] < -60
    assert "low_volume" in [issue["code"] for issue in result["audio_quality"]["issues"]]


def test_single_window_final_batch(real_client):
    # 16 windows + 1 window: PCA's upstream squeeze must not break concatenation.
    waveform, _ = decode_audio(SAMPLE.read_bytes(), ".ogg")
    import numpy as np
    extended = np.tile(waveform, 2)[:int(16.4 * 16000)]
    assert 0 <= module.engine.predict(extended)["score"] <= 1
