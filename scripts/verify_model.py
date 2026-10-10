"""Run real inference on an explicitly supplied, authorized recording."""
import argparse
import json
import platform
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.audio import decode_audio
from backend.inference import VoiceModel

parser = argparse.ArgumentParser()
parser.add_argument("audio", type=Path, help="Audio you have permission to process")
args = parser.parse_args()
model = VoiceModel()
started = time.perf_counter()
model.load()
if not model.ready:
    raise SystemExit(model.error)
load_seconds = time.perf_counter() - started
waveform, duration = decode_audio(args.audio.read_bytes(), args.audio.suffix)
outputs, timings = [], []
for _ in range(2):
    started = time.perf_counter()
    outputs.append(model.predict(waveform))
    timings.append(round(time.perf_counter() - started, 3))
print(json.dumps({
    "python": platform.python_version(), "platform": platform.platform(),
    "audit": model.audit, "load_seconds": round(load_seconds, 3),
    "duration": duration, "inference_seconds": timings,
    "repeat_delta": abs(outputs[0]["score"] - outputs[1]["score"]),
    "result": outputs[0],
}, ensure_ascii=False, indent=2))

