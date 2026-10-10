"""Fetch hash-pinned public VGGish assets. No audio is sent anywhere."""
import hashlib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "models"
ASSETS = [
    ("vggish-10086976.pth", "https://github.com/harritaylor/torchvggish/releases/download/v0.1/vggish-10086976.pth", "10086976245803799d9194e9a73d9b6c1549c71d1b80106f5cade5608a561f4b"),
    ("vggish_pca_params.npz", "https://storage.googleapis.com/audioset/vggish_pca_params.npz", "4d878af3e306defbfb37095365aa7e5a6cecb86bad13e859e626151c4e6a8b9d"),
]


def checksum(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    ROOT.mkdir(exist_ok=True)
    for name, url, digest in ASSETS:
        target = ROOT / name
        if target.exists() and checksum(target) == digest:
            print(f"Verified: {name}")
            continue
        staging = target.with_suffix(target.suffix + ".download")
        try:
            print(f"Downloading: {name}", flush=True)
            with urllib.request.urlopen(url, timeout=120) as source, staging.open("wb") as output:
                while block := source.read(1024 * 1024):
                    output.write(block)
            if checksum(staging) != digest:
                raise RuntimeError(f"Checksum mismatch: {name}")
            staging.replace(target)
        finally:
            staging.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
