"""openSMILE 2.5.1 requires ASCII config paths on Windows."""
import ctypes
import os
import shutil
import tempfile

import opensmile


class LocalSmile(opensmile.Smile):
    @property
    def default_config_root(self):
        path = super().default_config_root
        if path.isascii():
            return path
        if os.name == "nt":
            buffer = ctypes.create_unicode_buffer(32768)
            size = ctypes.windll.kernel32.GetShortPathNameW(path, buffer, len(buffer))
            if size and size < len(buffer) and buffer.value.isascii():
                return buffer.value
        if not hasattr(self, "_ascii_config"):
            cache = tempfile.TemporaryDirectory(prefix="srtp-smile-config-")
            if not cache.name.isascii():
                cache.cleanup()
                raise RuntimeError("Set TMP/TEMP to an ASCII-only directory for openSMILE configuration.")
            shutil.copytree(path, cache.name, dirs_exist_ok=True)
            self._ascii_config = cache
        return self._ascii_config.name

    def close(self):
        if hasattr(self, "_ascii_config"):
            self._ascii_config.cleanup()
