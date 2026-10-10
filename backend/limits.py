"""Bound request bodies before multipart parsing/spooling."""
from collections import deque

from starlette.responses import JSONResponse

from backend.audio import MAX_BYTES


class UploadLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != "/api/voice/analyze":
            return await self.app(scope, receive, send)
        cap = MAX_BYTES + 64 * 1024  # Multipart headers/form fields.
        headers = dict(scope.get("headers", []))
        response = JSONResponse({"error": {"code": "file_too_large", "message": "请求过大，音频不能超过 25 MB。"}}, status_code=413)
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = 0
        if length > cap:
            return await response(scope, receive, send)
        buffered, total = deque(), 0
        while True:
            item = await receive()
            if item["type"] == "http.disconnect":
                return
            total += len(item.get("body", b""))
            if total > cap:
                return await response(scope, receive, send)
            buffered.append(item)
            if not item.get("more_body", False):
                break

        async def replay():
            return buffered.popleft() if buffered else await receive()

        await self.app(scope, replay, send)

