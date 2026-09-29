# EMS web deployment: the web app and the EMS server in one container.
#   docker build -t ems .
#   docker run -p 8080:8080 -e DATABASE_URL=postgresql://… ems      (Supabase)
#   docker run -p 8080:8080 -v ems-data:/data ems                   (SQLite in a volume)
# See README → "Deploying EMS" for every setting.

FROM node:24-slim AS build
WORKDIR /app
# The desktop tooling (Electron) isn't needed here.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run web:build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    EMS_WEB_ROOT=/app/dist-web \
    EMS_DATA_DIR=/data \
    EMS_TRUST_PROXY=true \
    EMS_WAIT_FOR_LOCK=true
# The server bundle carries its own dependencies.
COPY --from=build /app/build/server ./build/server
COPY --from=build /app/dist-web ./dist-web
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "build/server/main.cjs"]
