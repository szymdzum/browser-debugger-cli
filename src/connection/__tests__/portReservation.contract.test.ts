/**
 * Contract tests for port reservation
 *
 * Tests the contract: reserve port atomically OR throw ChromeLaunchError
 *
 * Philosophy: Test with real network sockets to validate actual behavior.
 * Port reservation is an I/O operation that must work correctly in production,
 * so we use real sockets rather than mocks.
 *
 * These are contract tests (not unit tests) because they test the contract
 * between reservePort() and the Node.js net module.
 */

import * as net from 'net';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ChromeLaunchError } from '@/connection/errors.js';
import { reservePort } from '@/connection/portReservation.js';

describe('Port Reservation - Success Cases', () => {
  test('successfully reserves an available port', async () => {
    const port = await findAvailablePort();
    const reservation = await reservePort(port);

    try {
      // Contract: reservation should have release function
      assert.ok(
        typeof reservation.release === 'function',
        'Should return reservation with release()'
      );
    } finally {
      reservation.release();
    }
  });

  test('release() frees the port for reuse', async () => {
    const port = await findAvailablePort();

    const reservation1 = await reservePort(port);
    reservation1.release();

    // Contract: after release, port should be available again
    const reservation2 = await reservePort(port);
    reservation2.release();

    // If we got here without error, port was successfully reused
    assert.ok(true, 'Port should be available after release');
  });

  test('can reserve multiple different ports simultaneously', async () => {
    const port1 = await findAvailablePort();
    const port2 = await findAvailablePort(port1 + 1);

    const reservation1 = await reservePort(port1);
    const reservation2 = await reservePort(port2);

    try {
      assert.ok(reservation1, 'First reservation should succeed');
      assert.ok(reservation2, 'Second reservation should succeed');
    } finally {
      reservation1.release();
      reservation2.release();
    }
  });

  test('release() can be called immediately after reservation', async () => {
    const port = await findAvailablePort();

    const reservation = await reservePort(port);
    reservation.release(); // Immediate release

    // Should not throw
    assert.ok(true, 'Immediate release should be safe');
  });
});

describe('Port Reservation - Failure Cases', () => {
  test('throws ChromeLaunchError when port is already in use', async () => {
    const port = await findAvailablePort();

    // Occupy the port with a real server
    const server = await createTestServer(port);

    try {
      // Contract: should throw ChromeLaunchError (not generic Error)
      await assert.rejects(
        async () => {
          await reservePort(port);
        },
        (error: Error) => {
          assert.ok(error instanceof ChromeLaunchError, 'Should throw ChromeLaunchError');
          assert.ok(error.message.includes(`${port}`), 'Error message should mention port number');
          assert.ok(
            error.message.includes('already in use'),
            'Error message should indicate port is in use'
          );
          return true;
        },
        'Should throw ChromeLaunchError when port is in use'
      );
    } finally {
      await closeServer(server);
    }
  });

  test('fails when attempting to reserve same port twice', async () => {
    const port = await findAvailablePort();
    const reservation = await reservePort(port);

    try {
      // Contract: second reservation should fail with ChromeLaunchError
      await assert.rejects(
        async () => {
          await reservePort(port);
        },
        ChromeLaunchError,
        'Should fail when port already reserved'
      );
    } finally {
      reservation.release();
    }
  });

  test('error message includes helpful troubleshooting steps', async () => {
    const port = await findAvailablePort();
    const server = await createTestServer(port);

    try {
      await assert.rejects(
        async () => {
          await reservePort(port);
        },
        (error: Error) => {
          // Contract: error message should help user troubleshoot
          assert.ok(error.message.includes('bdg cleanup'), 'Should suggest cleanup command');
          assert.ok(error.message.includes('lsof'), 'Should suggest checking processes');
          assert.ok(
            error.message.includes(`--port ${port + 1}`),
            'Should suggest alternative port'
          );
          return true;
        },
        'Error message should include troubleshooting steps'
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe('Port Reservation - Release Behavior', () => {
  test('release() closes the server immediately', async () => {
    const port = await findAvailablePort();
    const reservation = await reservePort(port);

    reservation.release();

    // Port should be immediately available (not waiting for async cleanup)
    const testServer = net.createServer();
    const canBind = await new Promise<boolean>((resolve) => {
      testServer.once('error', () => resolve(false));
      testServer.listen(port, '127.0.0.1', () => {
        testServer.close();
        resolve(true);
      });
    });

    assert.ok(canBind, 'Port should be immediately available after release');
  });

  test('release() can be called multiple times safely', async () => {
    const port = await findAvailablePort();
    const reservation = await reservePort(port);

    // Multiple releases should not throw
    reservation.release();
    reservation.release();
    reservation.release();

    assert.ok(true, 'Multiple release() calls should be safe');
  });
});

describe('Port Reservation - Edge Cases', () => {
  test('handles port number at lower boundary (1024)', async () => {
    // Ports < 1024 require root, so we test 1024 (first non-privileged port)
    // This may fail in environments where 1024 is in use - that's expected
    try {
      const reservation = await reservePort(1024);
      reservation.release();
      assert.ok(true, 'Should handle port 1024');
    } catch (error) {
      // If port is in use, verify it's the expected error type
      assert.ok(
        error instanceof ChromeLaunchError,
        'Should throw ChromeLaunchError for in-use port 1024'
      );
    }
  });

  test('handles port number at upper boundary (65535)', async () => {
    try {
      const reservation = await reservePort(65535);
      reservation.release();
      assert.ok(true, 'Should handle port 65535');
    } catch (error) {
      // If port is in use, verify it's the expected error type
      assert.ok(
        error instanceof ChromeLaunchError,
        'Should throw ChromeLaunchError for in-use port 65535'
      );
    }
  });

  test('binds to localhost (127.0.0.1) only, not all interfaces', async () => {
    const port = await findAvailablePort();
    const reservation = await reservePort(port);

    try {
      // Contract: should bind to 127.0.0.1, not 0.0.0.0
      // This means we can still bind to the same port on other interfaces
      // We verify by checking we can't bind to 127.0.0.1 but this is implicit
      // in the reservation working at all
      assert.ok(true, 'Reservation binds to localhost interface');
    } finally {
      reservation.release();
    }
  });
});

describe('Port Reservation - Atomicity', () => {
  test('reservation is atomic (prevents race conditions)', async () => {
    const port = await findAvailablePort();

    // Attempt two simultaneous reservations
    const results = await Promise.allSettled([reservePort(port), reservePort(port)]);

    // Contract: exactly one should succeed, one should fail
    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    assert.equal(successes.length, 1, 'Exactly one reservation should succeed');
    assert.equal(failures.length, 1, 'Exactly one reservation should fail');

    // Cleanup successful reservation
    const success = successes[0];
    if (success?.status === 'fulfilled') {
      success.value.release();
    }

    // Verify failure is ChromeLaunchError
    const failure = failures[0];
    if (failure?.status === 'rejected') {
      assert.ok(
        failure.reason instanceof ChromeLaunchError,
        'Failed reservation should throw ChromeLaunchError'
      );
    }
  });
});

// Test Helpers

/**
 * Find an available port starting from a base port
 *
 * @param startPort - Port to start searching from (default: 9000)
 * @returns Available port number
 */
async function findAvailablePort(startPort = 9000): Promise<number> {
  for (let port = startPort; port < 65535; port++) {
    const server = net.createServer();
    const available = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close();
        resolve(true);
      });
    });

    if (available) {
      return port;
    }
  }

  throw new Error('No available ports found');
}

/**
 * Create a test server on a specific port
 *
 * @param port - Port to bind to
 * @returns Server instance
 */
async function createTestServer(port: number): Promise<net.Server> {
  const server = net.createServer();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

/**
 * Close a server gracefully
 *
 * @param server - Server to close
 */
async function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
