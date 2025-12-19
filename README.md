# ShitPostr

Meme search and management app with semantic search. Built for homelab self-hosting.

Inspired by [meme-search](https://github.com/neonwatty/meme-search) by neonwatty.

## Quick Start

```bash
# Local development
bun install
bun run dev

# Production with Docker
docker compose up
```

## Features

- **Semantic Search**: Vector-based search using all-MiniLM-L6-v2 embeddings (384-dim)
- **Hybrid Search**: Combines vector similarity with filename matching
- **AI Descriptions**: Optional Ollama llava:7b for auto-generating meme descriptions
- **Meme Editor**: Built-in editor with text overlays, fonts, colors, positioning
- **Zipline Integration**: Share edited memes directly to your Zipline instance
- **Multiple Source Directories**: Mount multiple meme collections via Docker volumes

## Zipline Integration

Share edited memes directly to Zipline with one click:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   ShitPostr │───►│   Zipline   │───►│  Clipboard  │
│  Meme Editor│    │   Upload    │    │  Share URL  │
└─────────────┘    └─────────────┘    └─────────────┘
        │                 │
        ▼                 ▼
   Canvas blob      POST /api/upload
   (PNG export)     Authorization: token
```

1. Edit meme in ShitPostr's meme editor
2. Click "Share to Zipline" button
3. Canvas exports as PNG blob
4. Blob uploads to Zipline via API
5. Zipline URL copied to clipboard

Configure with `ZIPLINE_URL` and `ZIPLINE_TOKEN` environment variables.

## Architecture

6 files total:

| File | Purpose |
|------|---------|
| `index.ts` | All backend: Hono server, API routes, DB, embeddings, scanner |
| `index.html` | All frontend: vanilla JS/CSS, grid, modals, meme editor |
| `schema.sql` | PostgreSQL + pgvector schema |
| `package.json` | 4 dependencies |
| `docker-compose.yml` | App + PostgreSQL containers |
| `Dockerfile` | Container build |

## Stack

- **Runtime**: Bun
- **Server**: Hono
- **Database**: PostgreSQL 17 + pgvector
- **Embeddings**: Xenova all-MiniLM-L6-v2
- **Vision AI**: Ollama llava:7b (optional)
- **Frontend**: Vanilla JS

## Environment Variables

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/shitpostr
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llava:7b
UPLOAD_DIR=/data/memes/uploads
PORT=3000

# Zipline integration
ZIPLINE_URL=https://your-zipline-instance.com
ZIPLINE_TOKEN=your-api-token

# Multiple source directories (comma-separated)
STATIC_DIRS=/data/memes,/data/imgflip,/data/community
```

## Multiple Source Directories

Mount multiple meme collections as separate Docker volumes:

```yaml
services:
  shitpostr:
    environment:
      - STATIC_DIRS=/data/memes,/data/imgflip,/data/community
    volumes:
      - meme-data:/data/memes          # uploads
      - imgflip-data:/data/imgflip      # imgflip templates
      - community-data:/data/community  # other sources
```

Then scan each directory:
```bash
curl -X POST http://localhost:3000/api/scan -H 'Content-Type: application/json' \
  -d '{"directory": "/data/imgflip"}'
```

## License

MIT
