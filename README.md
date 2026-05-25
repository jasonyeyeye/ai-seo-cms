# AI SEO CMS

A content management system with AI-powered SEO optimization built with Bun, ElysiaJS, and SQLite.

## Tech Stack

- **Runtime**: Bun
- **Backend**: ElysiaJS
- **Database**: SQLite with drizzle-orm
- **AI**: Groq API
- **Storage**: Cloudflare R2
- **Frontend**: Static HTML + Alpine.js + Tailwind CSS (CDN)

## Getting Started

```bash
# Install dependencies
bun install

# Set up environment variables
cp .env.example .env

# Run development server
bun run dev
```

## Project Structure

```
src/
  index.ts          # Main entry point
  db/schema.ts      # Database schema
  routes/           # API routes
  services/         # Business logic
    ai/             # AI service
    content/        # Content processing
    entity/        # Entity extraction
    seo/           # SEO optimization
  workers/          # Background workers
  scripts/          # Utility scripts
  views/            # HTML views
```

## Environment Variables

See `.env.example` for all required environment variables.
