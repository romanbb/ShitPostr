-- ShitPostr Database Schema
-- PostgreSQL 17 + pgvector

CREATE EXTENSION IF NOT EXISTS vector;

-- Main memes table
CREATE TABLE IF NOT EXISTS memes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- File location
    file_path TEXT NOT NULL UNIQUE,
    folder TEXT GENERATED ALWAYS AS (
        regexp_replace(file_path, '/[^/]+$', '')
    ) STORED,

    -- Content
    title TEXT,
    description TEXT,

    -- Search
    embedding vector(384),
    tags TEXT[] DEFAULT '{}',

    -- Status
    starred BOOLEAN DEFAULT false,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'complete', 'error')),

    -- Metadata (width, height, format, filesize, etc.)
    meta JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Settings table (key-value store)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_memes_folder ON memes (folder);
CREATE INDEX IF NOT EXISTS idx_memes_tags ON memes USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_memes_starred ON memes (starred) WHERE starred = true;
CREATE INDEX IF NOT EXISTS idx_memes_status ON memes (status);
CREATE INDEX IF NOT EXISTS idx_memes_created ON memes (created_at DESC);

-- Full-text search on description
CREATE INDEX IF NOT EXISTS idx_memes_description_fts ON memes
    USING gin (to_tsvector('english', COALESCE(description, '')));

-- Vector similarity search (ivfflat for speed)
-- Note: This index requires data to exist first, so we create it conditionally
-- CREATE INDEX IF NOT EXISTS idx_memes_embedding ON memes
--     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memes_updated_at ON memes;
CREATE TRIGGER memes_updated_at
    BEFORE UPDATE ON memes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS settings_updated_at ON settings;
CREATE TRIGGER settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Default settings
INSERT INTO settings (key, value) VALUES
    ('scan_paths', '[]'::jsonb),
    ('ml_model', '{"name": "moondream2", "endpoint": "http://image_to_text_generator:8000"}'::jsonb),
    ('embedding_model', '{"name": "all-MiniLM-L6-v2"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
