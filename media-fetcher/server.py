"""Serviço auxiliar do Segundo Cérebro: baixa mídia de links (Instagram, TikTok, etc.)
e devolve arquivos prontos para o Gemini (comprimidos para caber no limite inline)."""
import base64
import hmac
import http.client
import ipaddress
import json
import logging
import mimetypes
import os
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s media-fetcher %(message)s")
log = logging.getLogger("media-fetcher")

API_KEY = os.environ.get("FETCHER_API_KEY", "")
COOKIES_FILE = os.environ.get("COOKIES_FILE", "/data/cookies.txt")
PORT = int(os.environ.get("PORT", "8080"))

MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024
TOTAL_BUDGET_BYTES = 12 * 1024 * 1024
MAX_VIDEO_SECONDS = 15 * 60
MAX_AUDIO_SECONDS = 60 * 60
MAX_IMAGES = 10
YTDLP_TIMEOUT = 240
FFMPEG_TIMEOUT = 300
MAX_BODY_BYTES = 8192
ALLOWED_PORTS = (80, 443)
MAX_REDIRECTS = 5
REDIRECT_STATUSES = (301, 302, 303, 307, 308)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Só estas plataformas passam pelo yt-dlp (extratores próprios, sem o genérico). Qualquer outro link é baixado
# direto com o IP validado e fixado: o yt-dlp resolve DNS e segue redirects sozinho, sem as checagens de SSRF.
TRUSTED_MEDIA_HOSTS = (
    "instagram.com", "tiktok.com", "facebook.com", "fb.watch", "fb.com", "twitter.com", "x.com",
    "threads.net", "vimeo.com", "kwai.com", "pinterest.com", "pinterest.com.br", "pin.it", "reddit.com",
    "twitch.tv", "dailymotion.com",
    "youtube.com", "youtu.be", "youtube-nocookie.com",
    "drive.google.com", "drive.usercontent.google.com", "docs.google.com",
)

VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v", ".3gp", ".flv"}
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"}

slots = threading.BoundedSemaphore(2)


class FetchError(Exception):
    pass


def resolve_public(url):
    """Valida a URL e devolve (parsed, porta, ip). Todos os IPs do host precisam ser públicos."""
    try:
        parsed = urllib.parse.urlparse(url)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        raise FetchError("URL inválida")
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise FetchError("URL inválida")
    if parsed.username or parsed.password:
        raise FetchError("URL com credenciais não permitida")
    if port not in ALLOWED_PORTS:
        raise FetchError("Porta não permitida")
    try:
        infos = socket.getaddrinfo(parsed.hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise FetchError("Domínio não encontrado")
    if not infos:
        raise FetchError("Domínio não encontrado")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        ip = getattr(ip, "ipv4_mapped", None) or ip
        if not ip.is_global:
            raise FetchError("Endereço não permitido")
    return parsed, port, infos[0][4][0]


def assert_public_url(url):
    resolve_public(url)


def is_trusted_media_host(url):
    """True se o host for uma das plataformas de TRUSTED_MEDIA_HOSTS (ou subdomínio dela)."""
    try:
        host = (urllib.parse.urlparse(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    return any(host == base or host.endswith("." + base) for base in TRUSTED_MEDIA_HOSTS)


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """Conecta no IP já validado (evita DNS rebinding entre a checagem e o acesso)."""

    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port=port, timeout=timeout)
        self._pinned_ip = ip

    def connect(self):
        self.sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port=port, timeout=timeout, context=ssl.create_default_context())
        self._pinned_ip = ip

    def connect(self):
        sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _connect(parsed, port, ip, timeout):
    cls = _PinnedHTTPSConnection if parsed.scheme == "https" else _PinnedHTTPConnection
    return cls(parsed.hostname, ip, port, timeout)


def open_validated(url, timeout=30):
    """GET que valida o destino e cada redirecionamento. Devolve (conexão, resposta, url final)."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        parsed, port, ip = resolve_public(current)
        path = (parsed.path or "/") + ("?" + parsed.query if parsed.query else "")
        conn = _connect(parsed, port, ip, timeout)
        try:
            conn.request("GET", path, headers={"User-Agent": USER_AGENT})
            resp = conn.getresponse()
        except BaseException:
            conn.close()
            raise
        if resp.status in REDIRECT_STATUSES:
            location = resp.getheader("Location")
            resp.close()
            conn.close()
            if not location:
                raise FetchError("Redirecionamento sem destino")
            current = urllib.parse.urljoin(current, location)
            continue
        return conn, resp, current
    raise FetchError("Redirecionamentos demais")


def preflight(url):
    """Barra links cujo destino (ou cadeia de redirecionamentos) aponte para endereço interno.
    Devolve a URL final, já validada."""
    try:
        conn, resp, final_url = open_validated(url, timeout=15)
    except FetchError:
        raise
    except (OSError, http.client.HTTPException):
        # Falha fechada: se não dá para verificar o destino, o yt-dlp (que resolve DNS e segue redirects sozinho) não roda
        raise FetchError("Não foi possível verificar o link")
    resp.close()
    conn.close()
    return final_url


def run(cmd, timeout):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise FetchError("Tempo esgotado ao processar a mídia")


def kind_of(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in IMAGE_EXT:
        return "image"
    return None


def probe_duration(path):
    res = run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        30,
    )
    try:
        return float(res.stdout.strip())
    except ValueError:
        return 0.0


def has_video_stream(path):
    res = run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_type", "-of", "csv=p=0", path],
        30,
    )
    return "video" in res.stdout


def transcode_video(src, dst, budget_bytes, duration):
    audio_bps = 48_000
    total_bps = int(budget_bytes * 8 * 0.9 / max(duration, 1))
    video_bps = max(total_bps - audio_bps, 40_000)
    cmd = [
        "ffmpeg", "-y", "-i", src,
        "-vf", "scale='min(640,iw)':-2,fps=15",
        "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", str(video_bps), "-maxrate", str(int(video_bps * 1.4)),
        "-bufsize", str(video_bps * 2),
        "-c:a", "aac", "-b:a", "48k", "-ac", "1",
        "-movflags", "+faststart", dst,
    ]
    res = run(cmd, FFMPEG_TIMEOUT)
    if res.returncode != 0 or not os.path.exists(dst):
        raise FetchError("Falha ao comprimir o vídeo")


def transcode_audio(src, dst, bitrate="32k"):
    cmd = ["ffmpeg", "-y", "-i", src, "-vn", "-c:a", "aac", "-b:a", bitrate, "-ac", "1", dst]
    res = run(cmd, FFMPEG_TIMEOUT)
    if res.returncode != 0 or not os.path.exists(dst):
        raise FetchError("Falha ao extrair o áudio")


def shrink_image(src, dst):
    cmd = ["ffmpeg", "-y", "-i", src, "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", dst]
    res = run(cmd, 60)
    if res.returncode != 0 or not os.path.exists(dst):
        raise FetchError("Falha ao reduzir a imagem")


def download_with_ytdlp(url, workdir):
    cmd = [
        "yt-dlp", "--no-warnings", "--use-extractors", "default,-generic",
        "--yes-playlist", "--playlist-end", str(MAX_IMAGES),
        "--max-filesize", str(MAX_DOWNLOAD_BYTES), "--socket-timeout", "20", "--retries", "2",
        "-f", "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
        "--merge-output-format", "mp4", "--write-info-json", "--restrict-filenames",
        "-o", os.path.join(workdir, "%(autonumber)02d.%(ext)s"),
    ]
    if os.path.isfile(COOKIES_FILE):
        cmd += ["--cookies", COOKIES_FILE]
    cmd.append(url)
    res = run(cmd, YTDLP_TIMEOUT)
    media = [f for f in os.listdir(workdir) if kind_of(f)]
    if not media:
        tail = (res.stderr or "").strip().splitlines()[-1:] or ["sem detalhes"]
        raise FetchError("yt-dlp não conseguiu baixar: " + tail[0][:300])


def download_direct(url, workdir):
    conn, resp, _ = open_validated(url)
    try:
        mime = (resp.getheader("Content-Type") or "").split(";")[0].strip().lower()
        ext = mimetypes.guess_extension(mime) or ""
        if not (mime.startswith(("video/", "audio/", "image/"))):
            raise FetchError("O link não aponta para uma mídia baixável")
        path = os.path.join(workdir, "01" + ext)
        size = 0
        with open(path, "wb") as out:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_DOWNLOAD_BYTES:
                    raise FetchError("Arquivo grande demais")
                out.write(chunk)
    finally:
        resp.close()
        conn.close()


def read_metadata(workdir):
    for name in sorted(os.listdir(workdir)):
        if name.endswith(".info.json"):
            try:
                with open(os.path.join(workdir, name), encoding="utf-8") as fh:
                    info = json.load(fh)
            except (OSError, ValueError):
                continue
            return {
                "title": info.get("title") or "",
                "description": (info.get("description") or "")[:4000],
                "uploader": info.get("uploader") or info.get("channel") or "",
                "duration": info.get("duration") or 0,
            }
    return {}


def prepare_files(workdir):
    notes = []
    names = sorted(f for f in os.listdir(workdir) if kind_of(f))
    videos = [n for n in names if kind_of(n) == "video"]
    audios = [n for n in names if kind_of(n) == "audio"]
    images = [n for n in names if kind_of(n) == "image"][:MAX_IMAGES]
    ordered = videos + audios + images
    files = []
    remaining = TOTAL_BUDGET_BYTES

    for index, name in enumerate(ordered):
        src = os.path.join(workdir, name)
        kind = kind_of(name)
        share = max(remaining // max(len(ordered) - index, 1), 1)
        size = os.path.getsize(src)
        final, mime = src, mimetypes.guess_type(src)[0] or "application/octet-stream"

        if kind == "video":
            duration = probe_duration(src)
            audio_only = duration > MAX_VIDEO_SECONDS or not has_video_stream(src)
            if audio_only:
                if duration > MAX_AUDIO_SECONDS:
                    raise FetchError("Mídia longa demais (limite de 60 min)")
                final = os.path.join(workdir, "a_" + name + ".m4a")
                transcode_audio(src, final, "24k" if duration > 1800 else "32k")
                mime = "audio/mp4"
                if duration > MAX_VIDEO_SECONDS:
                    notes.append("Vídeo longo: apenas o áudio foi analisado.")
            elif size > share:
                final = os.path.join(workdir, "c_" + name + ".mp4")
                transcode_video(src, final, share, duration)
                mime = "video/mp4"
                notes.append("Vídeo comprimido para análise (qualidade visual reduzida).")
        elif kind == "audio" and size > share:
            final = os.path.join(workdir, "c_" + name + ".m4a")
            transcode_audio(src, final)
            mime = "audio/mp4"
        elif kind == "image" and size > min(share, 3 * 1024 * 1024):
            final = os.path.join(workdir, "c_" + name + ".jpg")
            shrink_image(src, final)
            mime = "image/jpeg"

        final_size = os.path.getsize(final)
        if final_size > share and kind != "image":
            raise FetchError("Não foi possível reduzir a mídia para o limite de análise")
        if final_size > remaining:
            notes.append("Alguns arquivos foram ignorados por excederem o limite.")
            continue
        remaining -= final_size
        with open(final, "rb") as fh:
            files.append({"mime": mime, "base64": base64.b64encode(fh.read()).decode("ascii")})

    if not files:
        raise FetchError("Nenhuma mídia utilizável encontrada")
    return files, notes


def fetch_media(url):
    final_url = preflight(url)
    # Plataforma -> plataforma (ex.: Reel que redireciona para o login): o extrator precisa da URL original.
    # Plataforma -> outro site (redirecionador de links) ou site qualquer: download direto do destino validado.
    use_ytdlp = is_trusted_media_host(url) and is_trusted_media_host(final_url)
    workdir = tempfile.mkdtemp(prefix="fetch_")
    try:
        if use_ytdlp:
            try:
                download_with_ytdlp(url, workdir)
            except FetchError as ytdlp_error:
                try:
                    download_direct(final_url, workdir)
                except (FetchError, OSError, ValueError):
                    raise ytdlp_error
        else:
            download_direct(final_url, workdir)
        meta = read_metadata(workdir)
        files, notes = prepare_files(workdir)
        return {"ok": True, "meta": meta, "files": files, "notes": notes}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def safe_target(url):
    """Só o host e o início do caminho: nunca query string, credenciais ou tokens nos logs."""
    try:
        parts = urllib.parse.urlsplit(url)
        return f"{parts.hostname or '?'}{parts.path[:40]}"
    except ValueError:
        return "?"


class Handler(BaseHTTPRequestHandler):
    server_version = "media-fetcher"

    def log_message(self, fmt, *args):
        return

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True})
        else:
            self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/fetch":
            return self.send_json(404, {"ok": False, "error": "not found"})
        supplied = self.headers.get("X-Api-Key", "")
        if not hmac.compare_digest(supplied.encode(), API_KEY.encode()):
            return self.send_json(401, {"ok": False, "error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError
            url = str(json.loads(self.rfile.read(length)).get("url", "")).strip()
        except (ValueError, AttributeError):
            return self.send_json(400, {"ok": False, "error": "corpo inválido"})
        target = safe_target(url)
        if not slots.acquire(timeout=5):
            log.warning("ocupado target=%s", target)
            return self.send_json(200, {"ok": False, "error": "Serviço ocupado, tente novamente"})
        started = time.monotonic()
        try:
            result = fetch_media(url)
            log.info("ok target=%s arquivos=%d segundos=%.1f", target, len(result.get("files", [])), time.monotonic() - started)
            self.send_json(200, result)
        except FetchError as err:
            log.warning("falha target=%s segundos=%.1f motivo=%s", target, time.monotonic() - started, err)
            self.send_json(200, {"ok": False, "error": str(err)})
        except Exception:
            log.exception("erro inesperado target=%s segundos=%.1f", target, time.monotonic() - started)
            self.send_json(200, {"ok": False, "error": "Erro inesperado ao processar a mídia"})
        finally:
            slots.release()


def main():
    if not API_KEY:
        raise SystemExit("FETCHER_API_KEY não definido")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
