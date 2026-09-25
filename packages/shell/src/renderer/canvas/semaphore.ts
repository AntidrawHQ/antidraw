export class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  // Returns a one-time release function (idempotent - safe to call multiple times)
  acquire(): Promise<() => void> {
    const createReleaser = () => {
      let released = false;
      return () => {
        if (released) return;
        released = true;

        const next = this.queue.shift();
        if (next) next();
        else this.permits++;
      };
    };

    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve(createReleaser());
    }

    return new Promise((resolve) => {
      this.queue.push(() => resolve(createReleaser()));
    });
  }
}
