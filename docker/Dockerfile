# syntax=docker/dockerfile:1
#
# Abbild von Culinola: Kern, alle mitgelieferten Plugins und die gebaute Oberfläche.
# Gebaut wird aus dem Hauptordner des Projekts:
#
#   docker build -f docker/Dockerfile -t culinola .
#
ARG NODE_VERSION=24

# --- Bauen: Oberfläche erzeugen, danach nur behalten, was zur Laufzeit gebraucht wird ---
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
COPY . .
# Nach dem Bauen der Oberfläche wird neu installiert, diesmal ohne Werkzeuge und ohne die
# Pakete der Oberfläche: Zur Laufzeit braucht es beides nicht mehr.
RUN npm ci \
 && npm run build \
 && npm ci --omit=dev --ignore-scripts -w packages/core -w packages/sdk -w packages/recipe-import -w plugins \
 && rm -rf packages/ui/src packages/ui/node_modules

# --- Laufzeit ---
FROM node:${NODE_VERSION}-bookworm-slim
ARG TARGETARCH

# Für Kameras und Fernsehen: go2rtc (MIT) und ffmpeg aus Debian. Beides sind eigenständige
# Programme, die Culinola nur aufruft. Mit --build-arg WITH_MEDIA=false bleibt beides draußen.
ARG WITH_MEDIA=true
ARG GO2RTC_VERSION=1.9.14
ARG GO2RTC_SHA256_AMD64=32d616af226bd731678ffde328b94cfb94e30339bfefc469cfb76323144615a6
ARG GO2RTC_SHA256_ARM64=359fabade8a7a51e81a55fe6df6b0ef81764a5e1d63179577534eaaa71904b50
RUN if [ "$WITH_MEDIA" = "true" ]; then \
      set -eux; \
      case "$TARGETARCH" in \
        amd64) sum="$GO2RTC_SHA256_AMD64" ;; \
        arm64) sum="$GO2RTC_SHA256_ARM64" ;; \
        *) echo "Für die Architektur '$TARGETARCH' ist keine Prüfsumme von go2rtc hinterlegt." >&2; exit 1 ;; \
      esac; \
      apt-get update; \
      apt-get install -y --no-install-recommends ca-certificates curl ffmpeg; \
      curl -fsSL -o /usr/local/bin/go2rtc "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${TARGETARCH}"; \
      echo "${sum}  /usr/local/bin/go2rtc" | sha256sum -c -; \
      chmod 0755 /usr/local/bin/go2rtc; \
      apt-get purge -y curl; \
      apt-get autoremove -y; \
      rm -rf /var/lib/apt/lists/*; \
    fi

ENV NODE_ENV=production \
    CULINOLA_DATA=/data
WORKDIR /app
COPY --from=build /src /app

# Konfiguration, Zugangsdaten, Rezepte und Senderlogos liegen außerhalb des Abbilds.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node

# 8090: Oberfläche und API. 8555: Bildübertragung der Kameras (WebRTC, TCP und UDP).
EXPOSE 8090 8555/tcp 8555/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node", "docker/healthcheck.mjs"]
CMD ["node", "packages/core/src/main.ts"]
