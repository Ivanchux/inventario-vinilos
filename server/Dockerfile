# Servidor de sincronización + la propia app, en un solo contenedor.
# Construir desde la raíz del repositorio:
#   docker build -f server/Dockerfile -t vinilos .
#   docker run -d -p 8787:8787 -v vinilos-data:/data -e CREATE_PASSWORD=una-clave vinilos
FROM node:22-alpine

WORKDIR /app
COPY server/server.js server/server.js
COPY index.html manifest.json service-worker.js ./
COPY css css
COPY js js
COPY icons icons

RUN mkdir -p /data && chown node:node /data
USER node

ENV PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/server.js"]
