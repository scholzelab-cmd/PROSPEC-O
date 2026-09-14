export class Mutex {
  private current: Promise<void> = Promise.resolve();

  async runExclusive<T>(work: () => Promise<T>): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.current;
    this.current = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await work();
    } finally {
      release();
    }
  }
}
