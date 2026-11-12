# KubeTrace API. Includes the Docker CLI (for the image-build adapter only) and kind (to load
# images into a kind cluster). The agent never gets either: it asks the backend to build.
FROM python:3.12-slim
ARG KIND_VERSION=v0.20.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin \
 && curl -fsSLo /usr/local/bin/kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-$(dpkg --print-architecture)" \
 && chmod +x /usr/local/bin/kind && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.7.13 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY services ./services
COPY experiments ./experiments
COPY demo ./demo
COPY deploy ./deploy
COPY config ./config
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["kubetrace", "serve", "--host", "0.0.0.0", "--port", "8000"]
