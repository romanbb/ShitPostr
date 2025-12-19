# CLAUDE.md

## Project Overview

ShitPostr is a meme search and management app with semantic search. Single-file architecture.

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Development with hot reload
bun run start        # Production

docker compose up    # Full stack with PostgreSQL
```

## Architecture

**6 files total:**

| File | Purpose |
|------|---------|
| `index.ts` | All backend: Hono server, API routes, DB, Ollama, embeddings, scanner |
| `index.html` | All frontend: vanilla JS/CSS, grid, modals, meme editor |
| `schema.sql` | PostgreSQL + pgvector schema |
| `package.json` | 4 dependencies |
| `docker-compose.yml` | App + PostgreSQL containers |
| `Dockerfile` | Container build |

## Stack

- **Runtime**: Bun
- **Server**: Hono
- **Database**: PostgreSQL 17 + pgvector
- **Embeddings**: Xenova all-MiniLM-L6-v2 (384-dim vectors)
- **Vision AI**: Ollama llava:7b (optional, for generating descriptions)
- **Frontend**: Vanilla JS, no framework

## Meme Templates

Templates are stored in `/data/memes/` (Docker volume: `shitpostr_meme-data`).

### Sources

1. **Imgflip API** (`scripts/download-imgflip-api.sh`)
   - Top 100 most-used meme templates
   - Full-size images from official API
   - Run: `./scripts/download-imgflip-api.sh /data/memes/imgflip-templates`

2. **Migrated from meme-search** (Rails app)
   - Original collection from `meme-search_meme-search-data` volume
   - Additional templates from `memesmith_meme-search-data` volume

### Current Collection

- ~173 imgflip templates (Drake, Distracted Boyfriend, etc.)
- ~14 other memes (examples, uploads)
- All high-quality (no thumbnails, all files >5KB)

### Adding More Templates

```bash
# Download from imgflip API:
./scripts/download-imgflip-api.sh /data/memes/imgflip-templates

# Then trigger a scan:
curl -X POST http://localhost:3000/api/scan -H 'Content-Type: application/json' -d '{"directory": "/data/memes"}'
```

## API Endpoints

```
GET  /                      HTML page
GET  /images/*              Static image files
GET  /health                Health check

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

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/shitpostr
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llava:7b
UPLOAD_DIR=/data/memes/uploads
PORT=3000
```

## Deployment

```bash
docker compose up -d
```

### Post-Deployment

1. Check status: `docker ps | grep shitpostr`
2. View logs: `docker logs -f shitpostr`
3. Trigger scan: `curl -X POST http://localhost:3000/api/scan -H 'Content-Type: application/json' -d '{"directory": "/data/memes"}'`

