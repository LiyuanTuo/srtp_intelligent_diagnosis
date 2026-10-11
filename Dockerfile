FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=10000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser

COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install torch==2.3.1 --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install -r requirements.txt

COPY --chown=appuser:appuser backend/ backend/
COPY --chown=appuser:appuser models/ models/
COPY --chown=appuser:appuser scripts/download_vggish.py scripts/download_vggish.py
COPY --chown=appuser:appuser vendor/ vendor/
COPY --chown=appuser:appuser web/ web/

USER appuser
RUN python scripts/download_vggish.py
EXPOSE 10000
CMD ["sh", "-c", "exec python -m uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --no-access-log"]
