// Simple in-memory job queue for tracking async generation jobs

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  status: JobStatus;
  progress?: number;
  result?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory job storage (use Redis or similar for production)
const jobs = new Map<string, Job>();

export const jobQueue = {
  // Create a new job
  create(jobId: string): Job {
    const job: Job = {
      id: jobId,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    jobs.set(jobId, job);
    return job;
  },

  // Get job by ID
  get(jobId: string): Job | undefined {
    return jobs.get(jobId);
  },

  // Update job status
  update(jobId: string, updates: Partial<Pick<Job, 'status' | 'progress' | 'result' | 'error'>>): Job | undefined {
    const job = jobs.get(jobId);
    if (!job) return undefined;

    const updatedJob: Job = {
      ...job,
      ...updates,
      updatedAt: new Date(),
    };
    jobs.set(jobId, updatedJob);
    return updatedJob;
  },

  // Mark job as processing
  start(jobId: string): Job | undefined {
    return this.update(jobId, { status: 'processing', progress: 0 });
  },

  // Mark job as completed with result
  complete(jobId: string, result: unknown): Job | undefined {
    return this.update(jobId, { status: 'completed', progress: 100, result });
  },

  // Mark job as failed with error
  fail(jobId: string, error: string): Job | undefined {
    return this.update(jobId, { status: 'failed', error });
  },

  // Update progress
  progress(jobId: string, progress: number): Job | undefined {
    return this.update(jobId, { progress });
  },

  // List all jobs (for debugging/admin)
  list(): Job[] {
    return Array.from(jobs.values());
  },

  // Clear completed/failed jobs older than given ms (cleanup)
  cleanup(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let count = 0;
    for (const [id, job] of jobs.entries()) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        now - job.updatedAt.getTime() > maxAgeMs
      ) {
        jobs.delete(id);
        count++;
      }
    }
    return count;
  },
};
