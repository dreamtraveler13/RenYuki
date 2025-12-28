type TaskFn = () => Promise<void>;

class GenerationQueue {
  private running = 0;
  private readonly concurrency: number;
  private readonly limit: number;
  private readonly queue: TaskFn[] = [];

  constructor(concurrency: number, limit: number) {
    this.concurrency = Math.max(1, concurrency);
    this.limit = Math.max(1, limit);
  }

  getStatus() {
    return {
      running: this.running,
      queued: this.queue.length,
      concurrency: this.concurrency,
      limit: this.limit,
    };
  }

  enqueue(task: TaskFn): { accepted: boolean; position: number; started: boolean } {
    if (this.queue.length >= this.limit) {
      return { accepted: false, position: this.queue.length + 1, started: false };
    }

    const started = this.running < this.concurrency && this.queue.length === 0;
    const position = this.queue.length + 1;
    this.queue.push(task);
    this.kick();
    return { accepted: true, position, started };
  }

  private kick() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.running += 1;
      task()
        .catch(() => {})
        .finally(() => {
          this.running -= 1;
          this.kick();
        });
    }
  }
}

const parseNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_QUEUE_LIMIT = 20;

const queue = new GenerationQueue(
  parseNumber(process.env.GENERATE_GAME_CONCURRENCY, DEFAULT_CONCURRENCY),
  parseNumber(process.env.GENERATE_GAME_QUEUE_LIMIT, DEFAULT_QUEUE_LIMIT)
);

export const getGenerationQueueStatus = () => queue.getStatus();

export const enqueueGenerationJob = (task: TaskFn) => queue.enqueue(task);

