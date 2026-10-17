FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 app \
    && python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -U "yt-dlp[default]" \
    && mkdir -p /data \
    && chown -R app:app /opt/venv /data

ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1
WORKDIR /app
COPY server.py .

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8080/health', timeout=3)"

# yt-dlp quebra com frequência quando as plataformas mudam: atualiza a cada start
CMD ["sh", "-c", "pip install --quiet -U 'yt-dlp[default]' || true; exec python /app/server.py"]
