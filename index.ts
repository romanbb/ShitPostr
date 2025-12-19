import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import postgres from 'postgres';
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { nanoid } from 'nanoid';
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

// =============================================================================
// CONFIG
// =============================================================================

const pkg = await Bun.file('package.json').json();
const VERSION = pkg.version;
const APP_NAME = process.env.APP_NAME || 'ShitPostr';
const PORT = parseInt(process.env.PORT || '3000');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/shitpostr';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llava:7b';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/memes/uploads';
const STATIC_DIRS = (process.env.STATIC_DIRS || '/data/memes').split(',').map(d => d.trim());
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

// =============================================================================
// DATABASE
// =============================================================================

const sql = postgres(DATABASE_URL, { max: 10 });

async function initDb() {
  const schema = await Bun.file('schema.sql').text();
  await sql.unsafe(schema);
  console.log('Database initialized');
}

// =============================================================================
// EMBEDDINGS
// =============================================================================

let embedder: FeatureExtractionPipeline | null = null;

async function getEmbedder() {
  if (!embedder) {
    console.log('Loading embedding model...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('Embedding model loaded');
  }
  return embedder;
}

async function embed(text: string): Promise<number[]> {
  const model = await getEmbedder();
  const result = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data as Float32Array);
}

// =============================================================================
// OLLAMA
// =============================================================================

async function describeImage(filePath: string): Promise<string> {
  // Try local path first (data/...), then Docker path (/data/...)
  let file = Bun.file(filePath);
  if (!await file.exists()) {
    const altPath = filePath.startsWith('/') ? filePath.slice(1) : `/${filePath}`;
    file = Bun.file(altPath);
    if (!await file.exists()) {
      throw new Error(`Image not found: ${filePath}`);
    }
  }
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: 'Describe this meme image briefly and concisely for search purposes. Focus on the visual content, any text visible, and the apparent humor or message. Keep it under 100 words.',
      images: [base64],
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.response;
}

async function checkOllama(): Promise<{ available: boolean; model: string; error?: string }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return { available: false, model: OLLAMA_MODEL, error: 'Cannot connect' };
    const data = await res.json();
    const hasModel = data.models?.some((m: { name: string }) => m.name.includes(OLLAMA_MODEL.split(':')[0]));
    return { available: hasModel, model: OLLAMA_MODEL, error: hasModel ? undefined : 'Model not found' };
  } catch (e) {
    return { available: false, model: OLLAMA_MODEL, error: 'Connection failed' };
  }
}

// =============================================================================
// SCANNER
// =============================================================================

let scanState = { status: 'idle' as 'idle' | 'scanning' | 'complete' | 'error', processed: 0, total: 0 };

async function* walkDir(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      yield* walkDir(fullPath);
    } else if (entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}

async function scanDirectory(dir: string): Promise<{ added: number; skipped: number }> {
  scanState = { status: 'scanning', processed: 0, total: 0 };
  let added = 0, skipped = 0;

  try {
    // Count first
    for await (const _ of walkDir(dir)) scanState.total++;
    console.log(`Scanning ${scanState.total} images in ${dir}`);

    // Process
    for await (const filePath of walkDir(dir)) {
      scanState.processed++;
      const [existing] = await sql`SELECT 1 FROM memes WHERE file_path = ${filePath}`;
      if (existing) { skipped++; continue; }

      const stats = await stat(filePath);
      await sql`INSERT INTO memes (file_path, meta) VALUES (${filePath}, ${sql.json({
        filesize: stats.size,
        format: extname(filePath).slice(1).toLowerCase(),
      })})`;
      added++;
    }

    scanState.status = 'complete';
    console.log(`Scan complete: ${added} added, ${skipped} skipped`);
    return { added, skipped };
  } catch (e) {
    scanState.status = 'error';
    throw e;
  }
}

// =============================================================================
// HONO APP
// =============================================================================

const app = new Hono();

// Serve static files
app.get('/', (c) => c.html(Bun.file('index.html').text()));

// Serve images from any /data/* directory via /images/*
// e.g., /images/memes/foo.jpg -> /data/memes/foo.jpg
app.get('/images/*', async (c) => {
  const subPath = c.req.path.slice('/images'.length); // e.g., /memes/uploads/xxx.jpg

  // Security: prevent directory traversal
  if (subPath.includes('..')) return c.text('Forbidden', 403);

  // Try local path first (data/...), then Docker path (/data/...)
  const localPath = `data${subPath}`;
  const dockerPath = `/data${subPath}`;

  // Validate path is under an allowed directory
  const isAllowed = STATIC_DIRS.some(dir =>
    dockerPath.startsWith(dir) || localPath.startsWith(dir.replace(/^\//, ''))
  );
  if (!isAllowed) return c.text('Forbidden', 403);

  let file = Bun.file(localPath);
  if (!await file.exists()) {
    file = Bun.file(dockerPath);
    if (!await file.exists()) {
      return c.text('Not found', 404);
    }
  }

  const ext = subPath.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
  c.header('Content-Type', types[ext || ''] || 'application/octet-stream');
  c.header('Content-Length', String(file.size));
  return c.body(file.stream());
});

// Health check
app.get('/health', (c) => c.json({ ok: true }));
app.get('/api/version', (c) => c.json({ version: VERSION, appName: APP_NAME }));

// Config (for frontend)
app.get('/api/config', (c) => c.json({
  ziplineUrl: process.env.ZIPLINE_URL || '',
  ziplineToken: process.env.ZIPLINE_TOKEN || ''
}));

// =============================================================================
// API: Memes
// =============================================================================

app.get('/api/memes', async (c) => {
  const { status, starred, limit = '50', offset = '0' } = c.req.query();
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (status) { conditions.push(`status = $${i++}`); values.push(status); }
  if (starred === 'true') { conditions.push(`starred = $${i++}`); values.push(true); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM memes ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
  values.push(parseInt(limit), parseInt(offset));

  const memes = await sql.unsafe(query, values);
  return c.json({ memes, count: memes.length });
});

app.get('/api/memes/:id', async (c) => {
  const [meme] = await sql`SELECT * FROM memes WHERE id = ${c.req.param('id')}`;
  return meme ? c.json(meme) : c.json({ error: 'Not found' }, 404);
});

app.patch('/api/memes/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (body.title !== undefined) { updates.push(`title = $${i++}`); values.push(body.title); }
  if (body.description !== undefined) { updates.push(`description = $${i++}`); values.push(body.description); }
  if (body.tags !== undefined) { updates.push(`tags = $${i++}`); values.push(body.tags); }
  if (body.starred !== undefined) { updates.push(`starred = $${i++}`); values.push(body.starred); }
  if (body.status !== undefined) { updates.push(`status = $${i++}`); values.push(body.status); }

  if (!updates.length) return c.json({ error: 'No updates' }, 400);
  values.push(id);

  const [meme] = await sql.unsafe(
    `UPDATE memes SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return meme ? c.json(meme) : c.json({ error: 'Not found' }, 404);
});

app.delete('/api/memes/:id', async (c) => {
  const result = await sql`DELETE FROM memes WHERE id = ${c.req.param('id')}`;
  return c.json({ success: result.count > 0 });
});

app.post('/api/memes/:id/star', async (c) => {
  const [meme] = await sql`
    UPDATE memes SET starred = NOT starred WHERE id = ${c.req.param('id')} RETURNING *
  `;
  return meme ? c.json(meme) : c.json({ error: 'Not found' }, 404);
});

app.post('/api/memes/:id/share', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { url, textBoxes } = body;

  const [meme] = await sql`SELECT * FROM memes WHERE id = ${id}`;
  if (!meme) return c.json({ error: 'Not found' }, 404);

  const meta = meme.meta || {};
  const shares = meta.shares || [];
  shares.push({ url, textBoxes: textBoxes || [], created_at: new Date().toISOString() });

  const [updated] = await sql`
    UPDATE memes SET meta = ${sql.json({ ...meta, shares })} WHERE id = ${id} RETURNING *
  `;
  return c.json(updated);
});

app.post('/api/memes/:id/generate', async (c) => {
  const id = c.req.param('id');
  const [meme] = await sql`SELECT * FROM memes WHERE id = ${id}`;
  if (!meme) return c.json({ error: 'Not found' }, 404);

  await sql`UPDATE memes SET status = 'processing' WHERE id = ${id}`;

  try {
    const description = await describeImage(meme.file_path);
    // Include filename in embedding for better search matching
    const filename = meme.file_path.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || '';
    const embeddingText = `${filename}. ${description}`;
    const embedding = await embed(embeddingText);
    await sql`UPDATE memes SET description = ${description}, embedding = ${`[${embedding.join(',')}]`}::vector, status = 'complete' WHERE id = ${id}`;
    return c.json({ success: true });
  } catch (e) {
    await sql`UPDATE memes SET status = 'error' WHERE id = ${id}`;
    return c.json({ error: String(e) }, 500);
  }
});

// =============================================================================
// API: Search
// =============================================================================

app.get('/api/search', async (c) => {
  const { q, mode = 'vector', limit = '20' } = c.req.query();
  if (!q) return c.json({ results: [] });

  const searchTerms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const lim = parseInt(limit);

  if (mode === 'vector') {
    const embedding = await embed(q);
    const embStr = `[${embedding.join(',')}]`;

    // Get vector search results (memes with embeddings)
    const vectorResults = await sql`
      SELECT *, 1 - (embedding <=> ${embStr}::vector) as vector_score
      FROM memes WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${embStr}::vector
      LIMIT ${lim * 3}
    `;

    // Also get filename/title matches (including those without embeddings)
    // Build a regex pattern that matches any search term
    const regexPattern = searchTerms.join('|');
    const filenameResults = await sql`
      SELECT *, 0.0 as vector_score
      FROM memes
      WHERE LOWER(COALESCE(title, '') || ' ' || file_path) ~ ${regexPattern}
      LIMIT ${lim * 2}
    `;

    // Combine and deduplicate
    const seen = new Set<string>();
    const combined: typeof vectorResults = [];
    for (const m of [...vectorResults, ...filenameResults]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        combined.push(m);
      }
    }

    // Calculate hybrid score with title/filename boost
    const scored = combined.map(m => {
      const filename = m.file_path.split('/').pop()?.toLowerCase() || '';
      const title = (m.title || '').toLowerCase();
      const searchable = `${filename} ${title}`;

      // Count how many search terms match
      const matches = searchTerms.filter(term => searchable.includes(term)).length;
      const titleBoost = matches > 0 ? 0.3 + (matches / searchTerms.length) * 0.4 : 0;

      return { meme: m, score: parseFloat(m.vector_score || 0) + titleBoost };
    });

    // Re-sort by hybrid score and take top results
    scored.sort((a, b) => b.score - a.score);
    return c.json({ results: scored.slice(0, lim) });
  } else {
    // Text search: search both description and title/filename
    const results = await sql`
      SELECT *,
        ts_rank(to_tsvector('english', COALESCE(description, '')), plainto_tsquery('english', ${q})) as desc_score,
        CASE WHEN LOWER(COALESCE(title, '') || ' ' || file_path) LIKE ${'%' + q.toLowerCase() + '%'} THEN 0.5 ELSE 0 END as title_score
      FROM memes
      WHERE to_tsvector('english', COALESCE(description, '')) @@ plainto_tsquery('english', ${q})
         OR LOWER(COALESCE(title, '') || ' ' || file_path) LIKE ${'%' + q.toLowerCase() + '%'}
      ORDER BY (desc_score + title_score) DESC
      LIMIT ${lim}
    `;
    return c.json({ results: results.map(m => ({ meme: m, score: (m.desc_score || 0) + (m.title_score || 0) })) });
  }
});

// =============================================================================
// API: Stats & Utilities
// =============================================================================

app.get('/api/stats', async (c) => {
  const [stats] = await sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
      COUNT(*) FILTER (WHERE status = 'processing')::int as processing,
      COUNT(*) FILTER (WHERE status = 'complete')::int as complete,
      COUNT(*) FILTER (WHERE status = 'error')::int as error,
      COUNT(*) FILTER (WHERE starred)::int as starred
    FROM memes
  `;
  return c.json(stats);
});

app.get('/api/ollama-status', async (c) => c.json(await checkOllama()));

app.post('/api/cleanup', async (c) => {
  const memes = await sql`SELECT id, file_path FROM memes`;
  let deleted = 0;
  for (const meme of memes) {
    const path = meme.file_path.startsWith('/') ? meme.file_path : `/${meme.file_path}`;
    if (!await Bun.file(path).exists()) {
      await sql`DELETE FROM memes WHERE id = ${meme.id}`;
      deleted++;
    }
  }
  return c.json({ checked: memes.length, deleted });
});

app.post('/api/reset-processing', async (c) => {
  const result = await sql`UPDATE memes SET status = 'pending' WHERE status = 'processing'`;
  return c.json({ reset: result.count });
});

app.post('/api/reset-errors', async (c) => {
  const result = await sql`UPDATE memes SET status = 'pending' WHERE status = 'error'`;
  return c.json({ reset: result.count });
});

// =============================================================================
// API: Upload & Scan
// =============================================================================

app.post('/api/upload', async (c) => {
  await mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});
  const formData = await c.req.formData();
  const files = formData.getAll('file') as File[];
  const results: { id?: string; name: string; success: boolean; error?: string }[] = [];

  for (const file of files) {
    try {
      if (!file.type.startsWith('image/')) {
        results.push({ name: file.name, success: false, error: 'Not an image' });
        continue;
      }
      const ext = extname(file.name) || `.${file.type.split('/')[1]}`;
      const filename = `${nanoid(12)}${ext}`;
      const filePath = join(UPLOAD_DIR, filename);
      await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
      const [meme] = await sql`INSERT INTO memes (file_path, title, meta) VALUES (${filePath}, ${file.name.replace(/\.[^/.]+$/, '')}, ${sql.json({ filesize: file.size })}) RETURNING *`;
      results.push({ id: meme.id, name: file.name, success: true });
    } catch (e) {
      results.push({ name: file.name, success: false, error: String(e) });
    }
  }

  return c.json({ uploaded: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results });
});

app.post('/api/scan', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const dir = body.directory || '/data/memes';

  if (scanState.status === 'scanning') {
    return c.json({ error: 'Scan already in progress' }, 409);
  }

  // Run async
  scanDirectory(dir).catch(e => console.error('Scan error:', e));
  return c.json({ success: true, message: `Started scanning ${dir}` });
});

app.get('/api/scan/status', (c) => c.json(scanState));

// =============================================================================
// API: Batch Generate
// =============================================================================

app.post('/api/generate-pending', async (c) => {
  const ollama = await checkOllama();
  if (!ollama.available) return c.json({ error: `Ollama unavailable: ${ollama.error}` }, 400);

  const pending = await sql`SELECT * FROM memes WHERE status = 'pending' LIMIT 1000`;
  let processed = 0, failed = 0;

  for (const meme of pending) {
    try {
      await sql`UPDATE memes SET status = 'processing' WHERE id = ${meme.id}`;
      const description = await describeImage(meme.file_path);
      // Include filename in embedding for better search matching
      const filename = meme.file_path.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || '';
      const embeddingText = `${filename}. ${description}`;
      const embedding = await embed(embeddingText);
      await sql`UPDATE memes SET description = ${description}, embedding = ${`[${embedding.join(',')}]`}::vector, status = 'complete' WHERE id = ${meme.id}`;
      processed++;
      console.log(`[${processed}/${pending.length}] Generated: ${meme.id}`);
    } catch (e) {
      await sql`UPDATE memes SET status = 'error' WHERE id = ${meme.id}`;
      failed++;
    }
  }

  return c.json({ processed, failed, total: pending.length });
});

// =============================================================================
// START
// =============================================================================

console.log(`Initializing ${APP_NAME}...`);
await initDb();
getEmbedder().catch(() => {}); // Warm up

export default { port: PORT, fetch: app.fetch };
console.log(`${APP_NAME} running on http://localhost:${PORT}`);
