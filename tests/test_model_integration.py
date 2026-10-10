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


def test_single_window_final_batch(real_client):
    # 16 windows + 1 window: PCA's upstream squeeze must not break concatenation.
    waveform, _ = decode_audio(SAMPLE.read_bytes(), ".ogg")
    import numpy as np
    extended = np.tile(waveform, 2)[:int(16.4 * 16000)]
    assert 0 <= module.engine.predict(extended)["score"] <= 1
