FROM ghcr.io/nuphos/backend:v0.85.0
COPY deploy/render/start.sh /app/render-start.sh
CMD ["sh", "/app/render-start.sh"]
