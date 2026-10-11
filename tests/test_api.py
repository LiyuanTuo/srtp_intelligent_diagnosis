from fastapi.testclient import TestClient

from backend import app as module

client = TestClient(module.app)  # No lifespan: no expensive model loading in contract tests.


def test_consent_required():
    response = client.post("/api/voice/analyze", data={"consent": "false"}, files={"audio": ("test.wav", b"test", "audio/wav")})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "consent_required"


def test_model_unavailable_never_returns_score(monkeypatch):
    monkeypatch.setattr(module.engine, "ready", False)
    response = client.post("/api/voice/analyze", data={"consent": "true"}, files={"audio": ("test.wav", b"test", "audio/wav")})
    assert response.status_code == 503
    assert "score" not in response.json()


def test_health_and_static_page(monkeypatch):
    monkeypatch.setattr(module.engine, "ready", False)
    assert client.get("/api/health").json()["status"] == "unavailable"
    assert '声语' in client.get("/").text
    assert client.get("/models/best_CFRAFN.pth").status_code == 404


def test_busy_response(monkeypatch):
    monkeypatch.setattr(module.engine, "ready", True)
    module.engine.lock.acquire()
    try:
        response = client.post("/api/voice/analyze", data={"consent": "true"}, files={"audio": ("test.wav", b"test", "audio/wav")})
        assert response.status_code == 429
        assert "score" not in response.json()
    finally:
        module.engine.lock.release()


def test_decode_failure_releases_lock(monkeypatch):
    monkeypatch.setattr(module.engine, "ready", True)
    response = client.post("/api/voice/analyze", data={"consent": "true"}, files={"audio": ("test.wav", b"test", "audio/wav")})
    assert response.status_code == 422
    assert not module.engine.lock.locked()


def test_oversized_body_rejected_before_multipart_parsing():
    response = client.post("/api/voice/analyze", content=b"", headers={"content-length": str(27 * 1024 * 1024)})
    assert response.status_code == 413


def test_missing_form_fields_has_consistent_error():
    response = client.post("/api/voice/analyze", data={})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert response.headers["cache-control"] == "no-store"


def test_health_does_not_claim_ready_when_decoder_is_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(module.engine, "ready", True)
    monkeypatch.setenv("FFMPEG_PATH", str(tmp_path / "missing-ffmpeg.exe"))
    response = client.get("/api/health")
    assert response.json()["decoder_ready"] is False
    assert response.json()["status"] == "unavailable"


def test_readiness_fails_when_model_is_unavailable(monkeypatch):
    monkeypatch.setattr(module.engine, "ready", False)
    assert client.get("/api/ready").status_code == 503
