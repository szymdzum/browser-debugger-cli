import type { BdgSession } from '@/session/BdgSession.js';
import type { CDPTarget, CDPTargetDestroyedParams } from '@/types';

/**
 * Manages the session monitoring loop
 */
export class SessionLoop {
  /**
   * Run session loop until stopped or error
   *
   * Monitors WebSocket connection and target lifecycle.
   * Throws error if connection lost or tab closed.
   *
   * @param session - Active BDG session instance
   * @param target - CDP target being monitored
   * @throws Error if WebSocket connection lost or browser tab closed
   */
  static async run(session: BdgSession, target: CDPTarget): Promise<void> {
    if (!session) {
      throw new Error('Session not initialized');
    }

    const cdp = session.getCDP();

    const waitForNextCheck = (): Promise<'continue' | 'destroyed'> =>
      new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        let handlerId: number;

        const handleTargetDestroyed = (params: CDPTargetDestroyedParams): void => {
          if (params.targetId === target.id) {
            clearTimeout(timer);
            cdp.off('Target.targetDestroyed', handlerId);
            resolve('destroyed');
          }
        };

        handlerId = cdp.on<CDPTargetDestroyedParams>(
          'Target.targetDestroyed',
          handleTargetDestroyed
        );

        timer = setTimeout(() => {
          cdp.off('Target.targetDestroyed', handlerId);
          resolve('continue');
        }, 2000);
      });

    for (;;) {
      const result = await waitForNextCheck();

      if (!session.isConnected()) {
        throw new Error('WebSocket connection lost');
      }

      if (result === 'destroyed') {
        throw new Error('Browser tab was closed');
      }
    }
  }
}
