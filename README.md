# ShitPostr

Meme search and management app with semantic search. Built for homelab.

Inspired by [meme-search](https://github.com/neonwatty/meme-search).

## Screenshots

| Grid | Detail | Editor |
|:---:|:---:|:---:|
| <img src="screenshots/grid.jpg" width="280" alt="Grid View"> | <img src="screenshots/detail.jpg" width="280" alt="Meme Detail"> | <img src="screenshots/editor.jpg" width="280" alt="Meme Editor"> |

## Quick Start

```bash
bun install && bun run dev     # Development
docker compose up              # Production
```

## Features

- **Semantic Search**: Vector embeddings (all-MiniLM-L6-v2) + filename matching
- **AI Descriptions**: Ollama vision model describes memes automatically
- **Meme Editor**: Add text overlays, choose fonts/colors
- **Zipline Sharing**: One-click upload edited memes to Zipline
- **Multi-Directory**: Mount multiple meme collections
- **Mobile Friendly**: Responsive layout for phone/tablet

## Ollama Integration

Generates searchable descriptions for memes using vision AI.

1. Run Ollama with a vision model: `ollama pull llava:7b`
2. Set `OLLAMA_URL` (default: `http://localhost:11434`)
3. Click "Generate" on a meme or use batch generate in Settings

The model analyzes each image and creates a text description used for semantic search.

## Zipline Integration

Share edited memes to your [Zipline](https://github.com/diced/zipline) instance.

1. Set `ZIPLINE_URL` to your Zipline upload endpoint
2. Set `ZIPLINE_TOKEN` to your API token
3. Edit a meme → click "Share to Zipline" → URL copied to clipboard

## Uploads

Drag & drop or click to upload images via the UI. Files save to `UPLOAD_DIR` (default `/data/memes/uploads`) and are automatically added to the database with "pending" status.

## Scanning

Scan directories to import existing meme collections:

```bash
curl -X POST http://localhost:3000/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"directory": "/data/memes"}'
```

The scanner recursively finds images (jpg, png, gif, webp, avif), adds them to the database, and extracts titles from filenames. Use Settings UI to trigger scans or batch-generate AI descriptions.

## Architecture

| File | Purpose |
|------|---------|
| `index.ts` | All backend: Hono server, API routes, DB, embeddings, scanner |
| `index.html` | All frontend: vanilla JS/CSS, grid, modals, meme editor |
| `schema.sql` | PostgreSQL + pgvector schema |
| `docker-compose.yml` | App + PostgreSQL containers |

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

# Zipline (optional)
ZIPLINE_URL=https://your-zipline.com
ZIPLINE_TOKEN=your-token

# Multiple source directories (comma-separated)
STATIC_DIRS=/data/memes,/data/imgflip
```

## Multiple Source Directories

Mount multiple meme collections as separate Docker volumes:

```yaml
services:
  shitpostr:
    environment:
      - STATIC_DIRS=/data/memes,/data/imgflip
    volumes:
      - meme-data:/data/memes
      - imgflip-data:/data/imgflip
```

Then scan each directory:
```bash
curl -X POST http://localhost:3000/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"directory": "/data/imgflip"}'
```

## Development

Built with [Claude Code](https://claude.ai/claude-code).

## License

MIT
