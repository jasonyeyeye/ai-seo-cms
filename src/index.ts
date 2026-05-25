import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { html } from '@elysiajs/html';
import { readFileSync } from 'fs';
import { join } from 'path';
import { promptsRouter } from './routes/prompts';
import { contentRoutes } from './routes/content';
import { ratingRoutes } from './routes/ratings';
import { affiliateRoutes } from './routes/affiliates';
import { dashboardRoutes } from './routes/dashboard';

const app = new Elysia()
  .use(cors())
  .use(html())
  .use(promptsRouter)
  .use(contentRoutes)
  .use(ratingRoutes)
  .use(affiliateRoutes)
  .use(dashboardRoutes)
  .get('/', () => {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI SEO CMS</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
</head>
<body class="bg-gray-100 min-h-screen">
  <div class="max-w-4xl mx-auto p-8">
    <h1 class="text-4xl font-bold text-gray-800 mb-4">AI SEO CMS</h1>
    <p class="text-gray-600">Welcome to AI SEO CMS v1.0.0</p>
  </div>
</body>
</html>`;
  })
  .get('/health', () => ({ status: 'ok', timestamp: Date.now() }))
  .get('/dashboard', () => {
    const dashboardPath = join(process.cwd(), 'src/views/dashboard.html');
    return new Response(readFileSync(dashboardPath), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  })
  .listen(3000);

console.log(`Server running at http://localhost:${app.server?.port}`);

export default app;
