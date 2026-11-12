FROM python:3.12-slim
RUN useradd --uid 10001 --create-home app
WORKDIR /app
COPY storefront ./storefront
USER 10001
ENV PYTHONUNBUFFERED=1 PORT=8080
EXPOSE 8080
CMD ["python", "-m", "storefront.server"]
