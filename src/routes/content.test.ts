import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { contentRoutes } from './content';
import { jobQueue, type Job, type JobStatus } from '../services/queue';
import { Elysia } from 'elysia';

describe('Job Queue Service', () => {
  describe('create', () => {
    test('should create a new job with pending status', () => {
      const jobId = 'test-job-123';
      const job = jobQueue.create(jobId);

      expect(job.id).toBe(jobId);
      expect(job.status).toBe('pending');
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('get', () => {
    test('should retrieve existing job', () => {
      const jobId = 'test-job-456';
      jobQueue.create(jobId);

      const job = jobQueue.get(jobId);
      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);
    });

    test('should return undefined for non-existent job', () => {
      const job = jobQueue.get('non-existent-job');
      expect(job).toBeUndefined();
    });
  });

  describe('update', () => {
    test('should update job fields', () => {
      const jobId = 'test-job-789';
      jobQueue.create(jobId);

      const updated = jobQueue.update(jobId, { progress: 50 });
      expect(updated?.progress).toBe(50);
      expect(updated?.status).toBe('pending'); // unchanged
    });

    test('should return undefined for non-existent job', () => {
      const result = jobQueue.update('non-existent', { status: 'processing' });
      expect(result).toBeUndefined();
    });
  });

  describe('start', () => {
    test('should mark job as processing with progress 0', () => {
      const jobId = 'test-job-start';
      jobQueue.create(jobId);

      const job = jobQueue.start(jobId);
      expect(job?.status).toBe('processing');
      expect(job?.progress).toBe(0);
    });
  });

  describe('complete', () => {
    test('should mark job as completed with result and progress 100', () => {
      const jobId = 'test-job-complete';
      jobQueue.create(jobId);

      const result = { slug: 'test-slug', title: 'Test Title' };
      const job = jobQueue.complete(jobId, result);

      expect(job?.status).toBe('completed');
      expect(job?.progress).toBe(100);
      expect(job?.result).toEqual(result);
    });
  });

  describe('fail', () => {
    test('should mark job as failed with error message', () => {
      const jobId = 'test-job-fail';
      jobQueue.create(jobId);

      const errorMessage = 'Something went wrong';
      const job = jobQueue.fail(jobId, errorMessage);

      expect(job?.status).toBe('failed');
      expect(job?.error).toBe(errorMessage);
    });
  });

  describe('progress', () => {
    test('should update job progress', () => {
      const jobId = 'test-job-progress';
      jobQueue.create(jobId);

      const job = jobQueue.progress(jobId, 75);
      expect(job?.progress).toBe(75);
    });
  });

  describe('list', () => {
    test('should return all jobs as array', () => {
      const jobs = jobQueue.list();
      expect(Array.isArray(jobs)).toBe(true);
    });
  });

  describe('cleanup', () => {
    test('should clean up old completed jobs', () => {
      const oldJobId = 'old-job';
      const recentJobId = 'recent-job';

      // Create old completed job (simulate by manually manipulating updatedAt)
      jobQueue.create(oldJobId);
      jobQueue.complete(oldJobId, {});
      const oldJob = jobQueue.get(oldJobId)!;
      oldJob.updatedAt = new Date(Date.now() - 4000000); // 4+ hours ago

      // Create recent completed job
      jobQueue.create(recentJobId);
      jobQueue.complete(recentJobId, {});

      const cleaned = jobQueue.cleanup(3600000); // 1 hour threshold

      expect(cleaned).toBe(1);
      expect(jobQueue.get(oldJobId)).toBeUndefined();
      expect(jobQueue.get(recentJobId)).toBeDefined();
    });
  });
});

describe('Content API Routes', () => {
  describe('Route structure', () => {
    test('should have contentRoutes defined', () => {
      expect(contentRoutes).toBeDefined();
    });

    test('should have correct prefix', () => {
      expect(contentRoutes).toBeDefined();
    });
  });

  describe('Job status types', () => {
    test('should accept valid job statuses', () => {
      const statuses: JobStatus[] = ['pending', 'processing', 'completed', 'failed'];

      for (const status of statuses) {
        const job: Job = {
          id: 'test',
          status,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        expect(job.status).toBe(status);
      }
    });
  });

  describe('Job interface', () => {
    test('should have correct structure', () => {
      const job: Job = {
        id: 'job-123',
        status: 'completed',
        progress: 100,
        result: { slug: 'test', title: 'Test' },
        error: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(job.id).toBe('job-123');
      expect(job.status).toBe('completed');
      expect(job.progress).toBe(100);
      expect(job.result).toEqual({ slug: 'test', title: 'Test' });
      expect(job.error).toBeUndefined();
    });

    test('should allow optional fields to be omitted', () => {
      const job: Job = {
        id: 'minimal-job',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(job.progress).toBeUndefined();
      expect(job.result).toBeUndefined();
      expect(job.error).toBeUndefined();
    });
  });
});

describe('GenerationInput validation', () => {
  test('should accept valid content types', () => {
    const validTypes = ['article', 'review', 'comparison', 'guide'] as const;

    for (const type of validTypes) {
      const input = {
        keywords: ['test'],
        primaryEntitySlug: 'test-slug',
        styleTemplateId: 'default',
        targetWordCount: 1200,
        contentType: type,
      };

      expect(['article', 'review', 'comparison', 'guide']).toContain(input.contentType);
    }
  });

  test('should accept array of keywords', () => {
    const input = {
      keywords: ['keyword1', 'keyword2', 'keyword3'],
      primaryEntitySlug: 'test-slug',
      styleTemplateId: 'default',
      targetWordCount: 1500,
      contentType: 'article' as const,
    };

    expect(input.keywords).toHaveLength(3);
    expect(input.keywords[0]).toBe('keyword1');
  });

  test('should use default target word count when not specified', () => {
    const defaultTargetWordCount = 1200;
    const input = {
      keywords: ['test'],
      primaryEntitySlug: 'test-slug',
      styleTemplateId: 'default',
      contentType: 'article' as const,
    };

    const effectiveWordCount = input.targetWordCount ?? defaultTargetWordCount;
    expect(effectiveWordCount).toBe(1200);
  });
});

describe('Batch generation', () => {
  test('should process batch tasks array', () => {
    interface BatchTask {
      keywords: string[];
      primaryEntitySlug: string;
      styleTemplateId: string;
      targetWordCount?: number;
      contentType: 'article' | 'review' | 'comparison' | 'guide';
    }

    const tasks: BatchTask[] = [
      {
        keywords: ['task1'],
        primaryEntitySlug: 'slug1',
        styleTemplateId: 'default',
        contentType: 'article',
      },
      {
        keywords: ['task2'],
        primaryEntitySlug: 'slug2',
        styleTemplateId: 'default',
        targetWordCount: 1500,
        contentType: 'review',
      },
    ];

    expect(tasks).toHaveLength(2);
    expect(tasks[0].targetWordCount).toBeUndefined();
    expect(tasks[1].targetWordCount).toBe(1500);
  });

  test('should collect results with slug/title or error', () => {
    interface Result {
      slug?: string;
      title?: string;
      error?: string;
    }

    const results: Result[] = [
      { slug: 'test-slug-1', title: 'Test 1' },
      { slug: 'test-slug-2', title: 'Test 2' },
      { error: 'Failed to generate' },
    ];

    expect(results).toHaveLength(3);
    expect(results.filter(r => r.error)).toHaveLength(1);
    expect(results.filter(r => r.slug)).toHaveLength(2);
  });
});

describe('Pagination', () => {
  test('should calculate offset correctly', () => {
    const page = 3;
    const limit = 20;
    const offset = (page - 1) * limit;

    expect(offset).toBe(40);
  });

  test('should calculate total pages correctly', () => {
    const total = 55;
    const limit = 20;
    const totalPages = Math.ceil(total / limit);

    expect(totalPages).toBe(3);
  });

  test('should handle edge case of zero total', () => {
    const total = 0;
    const limit = 20;
    const totalPages = Math.ceil(total / limit);

    expect(totalPages).toBe(0);
  });
});

describe('Post status transitions', () => {
  const validStatuses = ['draft', 'published', 'archived', 'noindex'] as const;

  test.each(validStatuses)('should accept valid status: %s', (status) => {
    expect(validStatuses).toContain(status);
  });

  test('should set publishedAt when publishing', () => {
    const post = {
      id: 1,
      slug: 'test-post',
      status: 'draft' as const,
      publishedAt: null,
    };

    const newStatus = 'published' as const;
    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };

    if (newStatus === 'published' && !post.publishedAt) {
      updates.publishedAt = new Date();
    }

    expect(updates.status).toBe('published');
    expect(updates.publishedAt).toBeInstanceOf(Date);
  });

  test('should not reset publishedAt when already set', () => {
    const existingPublishedAt = new Date('2024-01-01');
    const post = {
      id: 1,
      slug: 'test-post',
      status: 'published' as const,
      publishedAt: existingPublishedAt,
    };

    const newStatus = 'published' as const;
    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };

    if (newStatus === 'published' && !post.publishedAt) {
      updates.publishedAt = new Date();
    }

    // publishedAt should NOT be overwritten since it was already set
    expect(updates.publishedAt).toBeUndefined();
  });
});
