import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

/**
 * Upload content to R2
 */
export async function uploadToR2(
  key: string,
  body: string | Buffer,
  contentType: string
): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

/**
 * Read content from R2
 */
export async function getFromR2(key: string): Promise<string | null> {
  try {
    const response = await r2.send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));

    if (!response.Body) return null;

    // Convert stream to string
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return buffer.toString('utf-8');
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

/**
 * Check if object exists in R2
 */
export async function existsInR2(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Publish post HTML to edge (R2)
 */
export async function publishPostToEdge(
  slug: string,
  html: string
): Promise<void> {
  await uploadToR2(
    `posts/${slug}/index.html`,
    html,
    'text/html; charset=utf-8'
  );
}

/**
 * Publish entity page HTML to edge (R2)
 */
export async function publishEntityToEdge(
  slug: string,
  html: string
): Promise<void> {
  await uploadToR2(
    `entities/${slug}/index.html`,
    html,
    'text/html; charset=utf-8'
  );
}

/**
 * Publish index page to edge (R2)
 */
export async function publishIndexToEdge(html: string): Promise<void> {
  await uploadToR2(
    'index.html',
    html,
    'text/html; charset=utf-8'
  );
}
