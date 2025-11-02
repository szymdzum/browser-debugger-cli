/**
 * FakeClock - Deterministic timer control for tests
 *
 * Simulates setTimeout/setInterval and queueMicrotask to enable
 * deterministic testing of async code with timeouts.
 *
 * Key features:
 * - Separate macrotask (timers) and microtask (promise callbacks) queues
 * - Loop-based flush() drains microtasks until completely empty
 * - tick() advances timers without draining microtasks
 * - tickAsync() advances timers AND drains microtasks (for timeout tests)
 */

interface TimerTask {
  id: number;
  callback: () => void;
  triggerAt: number;
  interval?: number;
  type: 'timeout' | 'interval';
}

export class FakeClock {
  private currentTime = 0;
  private nextTimerId = 1;
  private timerTasks: Map<number, TimerTask> = new Map();
  private microtaskQueue: Array<() => void> = [];

  /**
   * Get current fake time in milliseconds
   */
  now(): number {
    return this.currentTime;
  }

  /**
   * Schedule a one-time timer (setTimeout)
   */
  setTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    const id = this.nextTimerId++;
    this.timerTasks.set(id, {
      id,
      callback,
      triggerAt: this.currentTime + delay,
      type: 'timeout',
    });
    return id as unknown as NodeJS.Timeout;
  }

  /**
   * Schedule a repeating timer (setInterval)
   */
  setInterval(callback: () => void, interval: number): NodeJS.Timeout {
    const id = this.nextTimerId++;
    this.timerTasks.set(id, {
      id,
      callback,
      triggerAt: this.currentTime + interval,
      interval,
      type: 'interval',
    });
    return id as unknown as NodeJS.Timeout;
  }

  /**
   * Cancel a timer (clearTimeout/clearInterval)
   */
  clearTimer(id: NodeJS.Timeout): void {
    this.timerTasks.delete(id as unknown as number);
  }

  /**
   * Queue a microtask (queueMicrotask, promise callbacks)
   */
  queueMicrotask(callback: () => void): void {
    this.microtaskQueue.push(callback);
  }

  /**
   * Advance time and execute all timers that should fire
   * Does NOT drain microtasks - use flush() or tickAsync() for that
   */
  tick(ms: number): void {
    this.currentTime += ms;

    // Find and execute all timers that should fire
    const tasksToFire = Array.from(this.timerTasks.values())
      .filter((task) => task.triggerAt <= this.currentTime)
      .sort((a, b) => a.triggerAt - b.triggerAt);

    for (const task of tasksToFire) {
      // Remove one-time timers
      if (task.type === 'timeout') {
        this.timerTasks.delete(task.id);
      }
      // Reschedule intervals
      else if (task.interval !== undefined) {
        task.triggerAt = this.currentTime + task.interval;
      }

      // Execute callback
      task.callback();
    }
  }

  /**
   * Drain the microtask queue completely
   * CRITICAL: Loops until queue is empty to handle cascading microtasks
   * (e.g., rejection handler that schedules another microtask)
   */
  flush(): void {
    // Loop-based drainage handles cascading microtasks
    while (this.microtaskQueue.length > 0) {
      const task = this.microtaskQueue.shift();
      if (task) {
        task(); // May enqueue more microtasks - loop continues
      }
    }
  }

  /**
   * Advance time AND drain all microtasks
   * Use this for timeout tests where rejections propagate via microtasks
   */
  async tickAsync(ms: number): Promise<void> {
    this.tick(ms);
    this.flush();
    // Allow Node's event loop to process any actual promises
    await Promise.resolve();
  }

  /**
   * Get number of pending timers
   */
  getPendingTimers(): number {
    return this.timerTasks.size;
  }

  /**
   * Get number of queued microtasks
   */
  getPendingMicrotasks(): number {
    return this.microtaskQueue.length;
  }

  /**
   * Reset clock to initial state
   */
  reset(): void {
    this.currentTime = 0;
    this.nextTimerId = 1;
    this.timerTasks.clear();
    this.microtaskQueue = [];
  }
}
