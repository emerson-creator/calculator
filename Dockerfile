# syntax=docker/dockerfile:1

# One image for the whole application: the Go server exposes the API and also
# serves the compiled React frontend, so there is a single process, a single
# port and no CORS.
#
#   docker build -t calculator .
#   docker run --rm -p 8080:8080 calculator
#
# Keep GO_VERSION in line with the "go" directive of backend/go.mod.
ARG GO_VERSION=1.27
ARG NODE_VERSION=22

# --- Stage 1: build the frontend -------------------------------------------
FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /app

# Dependencies first: this layer is reused until package*.json change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# --- Stage 2: build the backend --------------------------------------------
FROM golang:${GO_VERSION}-alpine AS backend
WORKDIR /src

# go.sum only exists once the module has dependencies, hence the wildcard.
COPY backend/go.mod backend/go.sum* ./
RUN go mod download

COPY backend/ ./
# A static binary (no cgo) runs on an image without a libc. -trimpath and
# -ldflags strip local paths and debug symbols.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# --- Stage 3: the image that runs ------------------------------------------
# Distroless: no shell and no package manager, only the binary and the static
# files. "nonroot" makes the process run as an unprivileged user.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=backend /out/server /server
COPY --from=frontend /app/dist /static

ENV PORT=8080 \
    STATIC_DIR=/static \
    CORS_ALLOWED_ORIGINS=""

EXPOSE 8080
ENTRYPOINT ["/server"]