# Disposable test runner image. Tests run in it with --network none, a read-only source
# mount, no credentials and no Docker socket. Dependencies are baked in at build time.
FROM python:3.12-slim
RUN pip install --no-cache-dir pytest==8.4.2 ruff==0.13.3 && useradd --uid 10001 --create-home runner
USER 10001
WORKDIR /work
