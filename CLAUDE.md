# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ShitPostr is a meme search and management app with semantic search. Built for homelab self-hosting.

**Philosophy**: Single-file architecture. All backend logic in `index.ts`, all frontend in `index.html`. Keep it simple.

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Development with hot reload
bun run start        # Production

docker compose up    # Full stack with PostgreSQL
```

## Architecture

| File | Purpose |
|------|---------|
| `index.ts` | All backend: Hono server, API routes, DB, Ollama, embeddings, scanner |
| `index.html` | All frontend: vanilla JS/CSS, grid, modals, meme editor |
| `schema.sql` | PostgreSQL + pgvector schema |
| `docker-compose.yml` | App + PostgreSQL containers |

## Key Patterns

- **Static files**: `/images/*` route maps to `/data/*` directories (configured via `STATIC_DIRS`)
- **Search**: Hybrid approach combining vector similarity + filename regex matching
- **Embeddings**: Generated client-side with Xenova transformers, stored as pgvector
- **Frontend state**: Global variables (`memes`, `currentMeme`, `filters`), vanilla JS DOM manipulation
- **URL helper**: `filePathToUrl()` converts DB paths to serving URLs

## Stack

- **Runtime**: Bun
- **Server**: Hono
- **Database**: PostgreSQL 17 + pgvector
- **Embeddings**: Xenova all-MiniLM-L6-v2 (384-dim vectors)
- **Vision AI**: Ollama llava:7b (optional)
- **Frontend**: Vanilla JS

## API Endpoints

```
GET  /                      HTML page
GET  /images/*              Static image files (maps to /data/*)
GET  /health                Health check
GET  /api/version           App version from package.json

GET  /api/memes             List memes (filters: status, starred)
GET  /api/memes/:id         Single meme
PATCH /api/memes/:id        Update meme
DELETE /api/memes/:id       Delete meme
POST /api/memes/:id/star    Toggle star
POST /api/memes/:id/generate Generate description

GET  /api/search            Search (params: q, mode=vector|text)
GET  /api/stats             Meme counts by status
GET  /api/ollama-status     Check Ollama availability

POST /api/upload            Upload images
POST /api/scan              Scan directory for images
GET  /api/scan/status       Scan progress

POST /api/generate-pending  Batch generate descriptions
POST /api/cleanup           Remove entries with missing files
POST /api/reset-processing  Reset stuck processing to pending
POST /api/reset-errors      Reset errors to pending
```

## Environment Variables

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/shitpostr
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llava:7b
UPLOAD_DIR=/data/memes/uploads
PORT=3000
STATIC_DIRS=/data/memes              # comma-separated for multiple
ZIPLINE_URL=https://your-zipline.com # optional
ZIPLINE_TOKEN=your-token             # optional
```

## Adding Memes

```bash
# Download imgflip templates
./scripts/download-imgflip-api.sh /data/memes/imgflip-templates

# Scan directory
curl -X POST http://localhost:3000/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"directory": "/data/memes"}'
```

## Deployment

```bash
docker compose up -d
docker ps | grep shitpostr
docker logs -f shitpostr
```
