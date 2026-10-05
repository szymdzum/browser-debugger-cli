/**
 * Session Port Management
 *
 * Handles automatic port selection and persistence for session isolation.
 * Each session directory can have its own persistent port, enabling multiple
 * concurrent bdg sessions (named sessions or different BDG_SESSION_DIR values).
 */

import * as fs from 'fs';
import * as net from 'net';

import { isPortAnswering } from '@/connection/portReservation.js';
import { DEFAULT_CDP_PORT } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import { ensureSessionDir, getSessionFilePath, getSessionName } from '@/session/paths.js';
import { portsClaimedByOtherSessions, readPortFile, withPortLock } from '@/session/portClaims.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Port range for automatic selection.
 * Starting from DEFAULT_CDP_PORT, scan up to find available ports.
 */
const PORT_RANGE_START = DEFAULT_CDP_PORT;
const PORT_RANGE_END = 9322; // Allow 100 ports for concurrent sessions

/**
 * Check if a port is available (not in use by any process, including one
 * listening on all interfaces or on ::1 only).
 *
 * @param port - Port number to check
 * @returns Promise resolving to true if port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  if (await isPortAnswering(port)) return false;
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/**
 * First port tried for this session: the default session starts at
 * DEFAULT_CDP_PORT, named sessions one above so they leave it to the default
 * session.
 *
 * @returns First candidate port
 */
export function firstCandidatePort(): number {
  return getSessionName() === null ? PORT_RANGE_START : PORT_RANGE_START + 1;
}

/**
 * Find an available port starting from a given port.
 *
 * @param startPort - Port to start scanning from
 * @param claimed - Ports to skip (claimed by other sessions)
 * @returns Promise resolving to an available port
 * @throws CommandError if no available port found in range
 */
export async function findAvailablePort(
  startPort: number = PORT_RANGE_START,
  claimed: ReadonlySet<number> = new Set()
): Promise<number> {
  for (let port = startPort; port <= PORT_RANGE_END; port++) {
    if (!claimed.has(port) && (await isPortAvailable(port))) {
      return port;
    }
  }
  throw new CommandError(
    `No available port found in range ${startPort}-${PORT_RANGE_END}.`,
    { suggestion: 'Stop some bdg sessions or Chrome instances and retry.' },
    EXIT_CODES.SOFTWARE_ERROR
  );
}

/**
 * Read the saved port from the session directory.
 *
 * @returns Saved port number or null if not found/invalid
 */
export function readSessionPort(): number | null {
  const portPath = getSessionFilePath('PORT');
  return fs.existsSync(portPath) ? readPortFile(portPath) : null;
}

/**
 * Save the port to the session directory.
 *
 * @param port - Port number to save
 */
export function writeSessionPort(port: number): void {
  ensureSessionDir();
  const portPath = getSessionFilePath('PORT');
  fs.writeFileSync(portPath, String(port), 'utf-8');
}

/**
 * Get or allocate a port for this session.
 *
 * Logic:
 * 1. If a port is explicitly provided, use it (user override; a named session
 *    saves and claims it under the lock so other sessions skip it)
 * 2. Otherwise, under a lock shared by all sessions on the machine (any
 *    BDG_SESSION_DIR), reuse the saved port if it is free and no other
 *    running session claims it (session stability)
 * 3. Otherwise, take the first free, unclaimed port from
 *    {@link firstCandidatePort} upwards and save it (the claim)
 *
 * The claim is also recorded in the machine-wide registry (under the lock),
 * so sessions of other base directories skip it too.
 *
 * This provides session isolation: named sessions and different
 * BDG_SESSION_DIR values automatically use different ports, even when they
 * start at the same time.
 *
 * @param explicitPort - User-provided port (takes precedence)
 * @returns Promise resolving to the port to use
 */
export async function getSessionPort(explicitPort?: number | null): Promise<number> {
  if (explicitPort !== undefined && explicitPort !== null) {
    if (getSessionName() === null) return explicitPort;
    return withPortLock((recordClaim) => {
      writeSessionPort(explicitPort);
      recordClaim(explicitPort);
      return Promise.resolve(explicitPort);
    });
  }
  return withPortLock(async (recordClaim) => {
    const claimed = portsClaimedByOtherSessions();
    const savedPort = readSessionPort();
    const reuse =
      savedPort !== null && !claimed.has(savedPort) && (await isPortAvailable(savedPort));
    const port = reuse ? savedPort : await findAvailablePort(firstCandidatePort(), claimed);
    writeSessionPort(port);
    recordClaim(port);
    return port;
  });
}
