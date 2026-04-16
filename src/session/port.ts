/**
 * Session Port Management
 *
 * Handles automatic port selection and persistence for session isolation.
 * Each session directory can have its own persistent port, enabling multiple
 * concurrent bdg sessions with different BDG_SESSION_DIR values.
 */

import * as fs from 'fs';
import * as net from 'net';

import { DEFAULT_CDP_PORT } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import { ensureSessionDir, getSessionFilePath } from '@/session/paths.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Port range for automatic selection.
 * Starting from DEFAULT_CDP_PORT, scan up to find available ports.
 */
const PORT_RANGE_START = DEFAULT_CDP_PORT;
const PORT_RANGE_END = 9322; // Allow 100 ports for concurrent sessions

/**
 * Check if a port is available (not in use by any process).
 *
 * @param port - Port number to check
 * @returns Promise resolving to true if port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
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
 * Find an available port starting from a given port.
 *
 * @param startPort - Port to start scanning from
 * @returns Promise resolving to an available port
 * @throws Error if no available port found in range
 */
async function findAvailablePort(startPort: number = PORT_RANGE_START): Promise<number> {
  for (let port = startPort; port <= PORT_RANGE_END; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new CommandError(
    `No available port found in range ${PORT_RANGE_START}-${PORT_RANGE_END}.`,
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
  try {
    const portPath = getSessionFilePath('PORT');
    if (!fs.existsSync(portPath)) {
      return null;
    }
    const content = fs.readFileSync(portPath, 'utf-8').trim();
    const port = parseInt(content, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return null;
    }
    return port;
  } catch {
    return null;
  }
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
 * 1. If a port is explicitly provided, use it (user override)
 * 2. Check if there's a saved port in the session directory
 * 3. If saved port exists and is available, reuse it (session stability)
 * 4. Otherwise, find a new available port and save it
 *
 * This provides session isolation: different BDG_SESSION_DIR values
 * will automatically use different ports.
 *
 * @param explicitPort - User-provided port (takes precedence)
 * @returns Promise resolving to the port to use
 */
export async function getSessionPort(explicitPort?: number | null): Promise<number> {
  // User explicitly specified a port - use it directly
  if (explicitPort !== undefined && explicitPort !== null) {
    return explicitPort;
  }

  // Check for saved session port
  const savedPort = readSessionPort();

  if (savedPort !== null) {
    // Verify the saved port is still available
    if (await isPortAvailable(savedPort)) {
      return savedPort;
    }
    // Saved port is in use by another process, need to find a new one
  }

  // Find a new available port
  const newPort = await findAvailablePort();
  writeSessionPort(newPort);
  return newPort;
}
