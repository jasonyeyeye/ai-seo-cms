import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

// =====================
// Content Module
// =====================

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").unique().notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "published", "archived", "noindex"] }).default("draft"),
  promptVersion: text("prompt_version"),
  styleTemplate: text("style_template"),
  primaryEntityId: integer("primary_entity_id").references(() => entities.id),
  contentMd: text("content_md").notNull(),
  contentHtml: text("content_html"),
  searchableText: text("searchable_text"), // FTS5
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  publishedAt: integer("published_at", { mode: "timestamp" }),
});

// =====================
// Knowledge Graph Module
// =====================

export const entities = sqliteTable("entities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").unique().notNull(),
  slug: text("slug").unique().notNull(),
  type: text("type", { enum: ["product", "brand", "technology", "person", "concept"] }).notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  structuredData: text("structured_data"),
});

export const entityAttributes = sqliteTable("entity_attributes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityId: integer("entity_id").references(() => entities.id).notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const entityRelations = sqliteTable("entity_relations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subjectEntityId: integer("subject_entity_id").references(() => entities.id).notNull(),
  predicate: text("predicate").notNull(),
  objectEntityId: integer("object_entity_id").references(() => entities.id).notNull(),
});

// =====================
// Sensing Layer Module
// =====================

export const suggestions = sqliteTable("suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id"),
  payload: text("payload").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected", "executed"] }).default("pending"),
  source: text("source").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  executedAt: integer("executed_at", { mode: "timestamp" }),
});

export const postSeoLogs = sqliteTable("post_seo_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").references(() => posts.id).notNull(),
  eeatScore: real("eeat_score"),
  infoGainScore: real("info_gain_score"),
  lifecycleStage: text("lifecycle_stage", { enum: ["hot", "warm", "cold", "archive"] }),
  gscClicks: integer("gsc_clicks"),
  gscImpressions: integer("gsc_impressions"),
  gscCtr: real("gsc_ctr"),
  avgRating: real("avg_rating"),
  recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
});

// =====================
// Additional Tables
// =====================

export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const postEmbeddings = sqliteTable("post_embeddings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").references(() => posts.id).unique().notNull(),
  embedding: text("embedding").notNull(), // JSON string "[0.1,0.2,...]"
  model: text("model").default('bge-small-en-v1.5'),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const postRatings = sqliteTable("post_ratings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").references(() => posts.id).notNull(),
  score: integer("score").notNull(),
  ipHash: text("ip_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const affiliateLinks = sqliteTable("affiliate_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").references(() => posts.id).notNull(),
  token: text("token").unique().notNull(),
  productName: text("product_name").notNull(),
  destinationUrl: text("destination_url").notNull(),
  platform: text("platform", { enum: ["amazon", "other"] }).default("amazon"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const affiliateClicks = sqliteTable("affiliate_clicks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  linkId: integer("link_id").references(() => affiliateLinks.id).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  referer: text("referer"),
  clickedAt: integer("clicked_at", { mode: "timestamp" }).notNull(),
});

export const apiUsageLogs = sqliteTable("api_usage_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  tokensUsed: integer("tokens_used").notNull(),
  endpoint: text("endpoint"),
  costEstimated: real("cost_estimated"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const pseudoAuthors = sqliteTable("pseudo_authors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  bio: text("bio"),
  styleTraits: text("style_traits"),
  avatarUrl: text("avatar_url"),
});

export const topics = sqliteTable("topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  parentId: integer("parent_id"),
  level: integer("level").default(0),
  maxArticles: integer("max_articles").default(30),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const postTopic = sqliteTable("post_topic", {
  postId: integer("post_id").references(() => posts.id).notNull(),
  topicId: integer("topic_id").references(() => topics.id).notNull(),
});
