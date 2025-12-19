FROM oven/bun:1.1-debian

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json ./
RUN bun install

# Copy app
COPY index.ts index.html schema.sql ./

# Create data directory
RUN mkdir -p /data/memes

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "index.ts"]
