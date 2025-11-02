/* eslint-disable @typescript-eslint/no-floating-promises */
/**
 * CDPConnection contract tests
 *
 * Tests the public API contracts of CDPConnection WITHOUT testing implementation details.
 * Uses FakeWebSocket to mock the WebSocket boundary while keeping all CDP logic real.
 *
 * Coverage:
 * 1. Message correlation - Request/response pairing with IDs
 * 2. Connection lifecycle - Connect, close, error handling
 * 3. Timeouts - Connection timeout (10s), command timeout (30s)
 * 4. Keepalive - Ping/pong lifecycle, missed pongs detection
 * 5. Event subscription - on/off/removeAllListeners
 * 6. Edge cases - Close during send, stale handlers, state transitions
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type WebSocket from 'ws';

import {
  createResponse,
  createErrorResponse,
  createEvent,
} from '@/__testfixtures__/cdpMessages.js';
import { FakeWebSocket } from '@/__testutils__/FakeWebSocket.js';
import { useFakeClock, type ClockHelper } from '@/__testutils__/testClock.js';
import type { CDPMessage, ConnectionOptions } from '@/types';

import { CDPConnection } from '../cdp.js';

// Mock the 'ws' module to return our FakeWebSocket
let mockWebSocket: FakeWebSocket;

describe('CDPConnection contract', () => {
  const TEST_URL = 'ws://localhost:9222/devtools/browser';
  let cdp: CDPConnection;

  async function connectAndOpen(options?: ConnectionOptions): Promise<void> {
    const connectPromise = cdp.connect(TEST_URL, options);
    mockWebSocket.simulateOpen();
    await connectPromise;
  }

  function parseMessage(raw: string): CDPMessage {
    return JSON.parse(raw) as CDPMessage;
  }

  // Shared setup for non-timer tests
  beforeEach(() => {
    mockWebSocket = new FakeWebSocket();
    cdp = new CDPConnection(() => mockWebSocket as unknown as WebSocket);
  });

  afterEach(() => {
    // Cleanup: close connection if still open
    if (cdp.isConnected()) {
      cdp.close();
    }
  });

  describe('Message correlation', () => {
    it('should pair requests with responses by message ID', async () => {
      // Arrange: Create CDP connection with fake WebSocket
      await connectAndOpen();

      // Act: Send a CDP command
      const resultPromise = cdp.send('Target.getTargets');

      // Get the sent message
      const messages = mockWebSocket.getSentMessages();
      assert.equal(messages.length, 1);
      const [firstMessage] = messages;
      assert.ok(firstMessage, 'Expected a sent message');
      const sentMessage = parseMessage(firstMessage);
      assert.equal(typeof sentMessage.id, 'number');
      const requestId = sentMessage.id as number;

      // Simulate response with matching ID
      const response = createResponse(requestId, { targetInfos: [] });
      mockWebSocket.simulateMessage(JSON.stringify(response));

      // Assert: Promise resolves with correct result
      const result = await resultPromise;
      assert.deepEqual(result, { targetInfos: [] });
    });

    it('should reject on error responses', async () => {
      // Arrange
      await connectAndOpen();

      // Act: Send command
      const resultPromise = cdp.send('Invalid.method');

      const messages = mockWebSocket.getSentMessages();
      const [firstMessage] = messages;
      assert.ok(firstMessage, 'Expected a sent message');
      const sentMessage = parseMessage(firstMessage);
      assert.equal(typeof sentMessage.id, 'number');
      const requestId = sentMessage.id as number;

      // Simulate error response
      const errorResponse = createErrorResponse(requestId, 'Method not found');
      mockWebSocket.simulateMessage(JSON.stringify(errorResponse));

      // Assert: Promise rejects with error message
      await assert.rejects(resultPromise, /Method not found/);
    });

    it('should handle multiple concurrent requests', async () => {
      // Arrange
      await connectAndOpen();

      // Act: Send three commands concurrently
      const promise1 = cdp.send('Target.getTargets');
      const promise2 = cdp.send('Browser.getVersion');
      const promise3 = cdp.send('Page.navigate', { url: 'http://example.com' });

      const messages = mockWebSocket.getSentMessages();
      assert.equal(messages.length, 3);

      // Simulate responses in different order (3, 1, 2)
      const [message1, message2, message3] = messages;
      if (message1 === undefined || message2 === undefined || message3 === undefined) {
        throw new Error('Expected three sent messages');
      }
      const msg1 = parseMessage(message1);
      const msg2 = parseMessage(message2);
      const msg3 = parseMessage(message3);

      assert.equal(typeof msg1.id, 'number');
      assert.equal(typeof msg2.id, 'number');
      assert.equal(typeof msg3.id, 'number');

      mockWebSocket.simulateMessage(
        JSON.stringify(createResponse(msg3.id as number, { frameId: 'frame1' }))
      );
      mockWebSocket.simulateMessage(
        JSON.stringify(createResponse(msg1.id as number, { targetInfos: [] }))
      );
      mockWebSocket.simulateMessage(
        JSON.stringify(createResponse(msg2.id as number, { protocolVersion: '1.3' }))
      );

      // Assert: All promises resolve with correct results despite out-of-order responses
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
      assert.deepEqual(result1, { targetInfos: [] });
      assert.deepEqual(result2, { protocolVersion: '1.3' });
      assert.deepEqual(result3, { frameId: 'frame1' });
    });
  });

  describe('Connection lifecycle', () => {
    it('should resolve when WebSocket opens successfully', async () => {
      // Arrange & Act
      const connectPromise = cdp.connect(TEST_URL);

      // Simulate successful open
      mockWebSocket.simulateOpen();

      // Assert: Connect resolves without error
      await assert.doesNotReject(connectPromise);
      assert.equal(cdp.isConnected(), true);
    });

    it('should throw error if connection fails', async () => {
      const clock = useFakeClock();
      try {
        mockWebSocket = new FakeWebSocket();
        cdp = new CDPConnection(() => mockWebSocket as unknown as WebSocket);

        // Arrange & Act
        const connectPromise = cdp.connect(TEST_URL, {
          maxRetries: 1,
        });

        // Simulate connection error immediately (before retry timer starts)
        mockWebSocket.simulateError(new Error('Connection refused'));

        // Advance time to trigger retry handling (even though maxRetries=1)
        await clock.tickAndFlush(1000);

        // Assert: Connect rejects with connection error
        await assert.rejects(connectPromise, /Connection refused|Failed to connect/);
        assert.equal(cdp.isConnected(), false);
      } finally {
        clock.restore();
      }
    });

    it('should cleanup on close and reject pending messages', async () => {
      // Arrange
      const connectPromise = cdp.connect(TEST_URL, {
        maxRetries: 1,
      });
      mockWebSocket.simulateOpen();
      await connectPromise;

      // Send a command but don't respond
      const pendingPromise = cdp.send('Target.getTargets');

      // Act: Close connection
      mockWebSocket.simulateClose(1000, 'Normal closure');

      // Assert: Pending promise is rejected
      await assert.rejects(pendingPromise, /connection closed/i);
    });

    it('should prevent sending commands when not connected', async () => {
      // Arrange: No connection established

      // Act & Assert: Sending command should throw immediately
      await assert.rejects(() => cdp.send('Target.getTargets'), /Not connected to browser/);
    });
  });

  // Timer-dependent tests: Install FakeClock in beforeEach
  describe('Timeouts', () => {
    let clockHelper: ClockHelper;

    beforeEach(() => {
      // Install fake timers BEFORE creating CDP connection
      clockHelper = useFakeClock();
      mockWebSocket = new FakeWebSocket();
      cdp = new CDPConnection(() => mockWebSocket as unknown as WebSocket);
    });

    afterEach(() => {
      clockHelper.restore();
      if (cdp.isConnected()) {
        cdp.close();
      }
    });

    it('should timeout connection after 10s by default', async () => {
      // Arrange & Act: Start connection but never open WebSocket
      const connectPromise = cdp.connect('ws://localhost:9222/devtools/browser', {
        maxRetries: 1,
      });

      // Advance time by 10s (default connection timeout)
      await clockHelper.tickAndFlush(10000);

      // Assert: Connection times out
      await assert.rejects(connectPromise, /Connection timeout|Failed to connect/);
      assert.equal(clockHelper.clock.getPendingTimers(), 0);
      assert.equal(clockHelper.clock.getPendingMicrotasks(), 0);
    });

    it('should timeout commands after 30s', async () => {
      // Arrange: Establish connection
      await connectAndOpen({ maxRetries: 1 });

      // Act: Send command without responding
      const commandPromise = cdp.send('Target.getTargets');

      // Advance time by 30s (command timeout)
      await clockHelper.tickAndFlush(30000);

      // Assert: Command times out
      await assert.rejects(commandPromise, /Command timeout/);

      // Close connection to stop keepalive timers before checking pending handles
      cdp.close();
      assert.equal(clockHelper.clock.getPendingTimers(), 0);
      assert.equal(clockHelper.clock.getPendingMicrotasks(), 0);
    });
  });

  describe('Keepalive', () => {
    let clockHelper: ClockHelper;

    beforeEach(() => {
      // Install fake timers BEFORE creating CDP connection
      clockHelper = useFakeClock();
      mockWebSocket = new FakeWebSocket();
      cdp = new CDPConnection(() => mockWebSocket as unknown as WebSocket);
    });

    afterEach(() => {
      clockHelper.restore();
      if (cdp.isConnected()) {
        cdp.close();
      }
    });

    it('should send ping at regular intervals', async () => {
      // Arrange: Connect with 5s keepalive interval
      await connectAndOpen({ keepaliveInterval: 5000, maxRetries: 1 });

      // Act: Advance time by 5s
      clockHelper.tick(5000);

      // Assert: Ping sent
      assert.equal(mockWebSocket.getPingSent(), 1);

      // Act: Advance another 5s
      clockHelper.tick(5000);

      // Assert: Second ping sent
      assert.equal(mockWebSocket.getPingSent(), 2);
    });

    it('should close connection after 3 missed pongs', async () => {
      // Arrange: Connect with 1s keepalive
      await connectAndOpen({ keepaliveInterval: 1000, maxRetries: 1 });

      // Act: Miss 3 pongs (don't call simulatePong)
      clockHelper.tick(1000); // 1st ping
      clockHelper.tick(1000); // 2nd ping
      clockHelper.tick(1000); // 3rd ping - should close

      // Assert: Connection closed after 3 missed pongs
      assert.equal(mockWebSocket.getCloseCode(), 1001);
      assert.match(mockWebSocket.getCloseReason() ?? '', /No pong received/i);
    });

    it('should reset missed pong counter on pong received', async () => {
      // Arrange
      await connectAndOpen({ keepaliveInterval: 1000, maxRetries: 1 });

      // Act: Miss 2 pongs, then receive one
      clockHelper.tick(1000); // 1st ping
      clockHelper.tick(1000); // 2nd ping
      mockWebSocket.simulatePong(); // Reset counter

      // Now miss 2 more - should NOT close (counter was reset)
      clockHelper.tick(1000); // 3rd ping
      clockHelper.tick(1000); // 4th ping

      // Assert: Still connected (would close on 3rd consecutive miss)
      assert.equal(cdp.isConnected(), true);
    });
  });

  describe('Event subscription', () => {
    it('should invoke event handlers when events arrive', async () => {
      // Arrange
      await connectAndOpen();

      const receivedEvents: unknown[] = [];
      cdp.on('Target.targetCreated', (params) => {
        receivedEvents.push(params);
      });

      // Act: Simulate event
      const event = createEvent('Target.targetCreated', {
        targetInfo: { targetId: 't1', type: 'page' },
      });
      mockWebSocket.simulateMessage(JSON.stringify(event));

      // Assert: Handler invoked
      assert.equal(receivedEvents.length, 1);
      assert.deepEqual(receivedEvents[0], { targetInfo: { targetId: 't1', type: 'page' } });
    });

    it('should allow multiple handlers for same event', async () => {
      // Arrange
      await connectAndOpen();

      const handler1Called: unknown[] = [];
      const handler2Called: unknown[] = [];

      cdp.on('Network.requestWillBeSent', (params) => handler1Called.push(params));
      cdp.on('Network.requestWillBeSent', (params) => handler2Called.push(params));

      // Act: Simulate event
      const event = createEvent('Network.requestWillBeSent', { requestId: 'req1' });
      mockWebSocket.simulateMessage(JSON.stringify(event));

      // Assert: Both handlers called
      assert.equal(handler1Called.length, 1);
      assert.equal(handler2Called.length, 1);
    });

    it('should remove handler with off()', async () => {
      // Arrange
      await connectAndOpen();

      let callCount = 0;
      const handlerId = cdp.on('Page.frameNavigated', () => callCount++);

      // Act: Send event, then remove handler, then send again
      const event = createEvent('Page.frameNavigated', { frame: { id: 'f1' } });
      mockWebSocket.simulateMessage(JSON.stringify(event));

      cdp.off('Page.frameNavigated', handlerId);

      mockWebSocket.simulateMessage(JSON.stringify(event));

      // Assert: Handler only called once (before removal)
      assert.equal(callCount, 1);
    });

    it('should remove all handlers for event with removeAllListeners(event)', async () => {
      // Arrange
      await connectAndOpen();

      let callCount1 = 0;
      let callCount2 = 0;
      cdp.on('Console.messageAdded', () => callCount1++);
      cdp.on('Console.messageAdded', () => callCount2++);

      // Act: Remove all handlers for this event
      cdp.removeAllListeners('Console.messageAdded');

      const event = createEvent('Console.messageAdded', { message: { text: 'test' } });
      mockWebSocket.simulateMessage(JSON.stringify(event));

      // Assert: No handlers called
      assert.equal(callCount1, 0);
      assert.equal(callCount2, 0);
    });

    it('should remove all handlers for all events with removeAllListeners()', async () => {
      // Arrange
      await connectAndOpen();

      let callCount1 = 0;
      let callCount2 = 0;
      cdp.on('Network.requestWillBeSent', () => callCount1++);
      cdp.on('Console.messageAdded', () => callCount2++);

      // Act: Remove all handlers
      cdp.removeAllListeners();

      mockWebSocket.simulateMessage(JSON.stringify(createEvent('Network.requestWillBeSent', {})));
      mockWebSocket.simulateMessage(JSON.stringify(createEvent('Console.messageAdded', {})));

      // Assert: No handlers called
      assert.equal(callCount1, 0);
      assert.equal(callCount2, 0);
    });
  });

  describe('Edge cases', () => {
    it('should handle close during send (defensive copy test)', async () => {
      // Arrange
      await connectAndOpen();

      // Act: Send command
      const commandPromise = cdp.send('Target.getTargets');

      // Capture messages snapshot before close
      const messagesBefore = mockWebSocket.getSentMessages();
      assert.equal(messagesBefore.length, 1);

      // Close connection (should reject pending)
      mockWebSocket.simulateClose(1000, 'Test close');

      // Verify defensive copy: messagesBefore should be unchanged
      assert.equal(messagesBefore.length, 1);

      // Assert: Command rejected
      await assert.rejects(commandPromise, /connection closed/i);
    });

    it('should return correct port from getPort()', async () => {
      // Arrange & Act
      const connectPromise = cdp.connect('ws://localhost:9444/devtools/browser');
      mockWebSocket.simulateOpen();
      await connectPromise;

      // Assert: Port extracted correctly
      const port = cdp.getPort();
      assert.equal(port, 9444);
    });

    it('should throw if getPort() called before connect', () => {
      // Arrange: No connection

      // Act & Assert
      assert.throws(() => cdp.getPort(), /Not connected/);
    });

    it('should handle events with sessionId', async () => {
      // Arrange
      const connectPromise = cdp.connect('ws://localhost:9222/devtools/browser');
      mockWebSocket.simulateOpen();
      await connectPromise;

      const receivedEvents: unknown[] = [];
      cdp.on('Page.frameNavigated', (params) => receivedEvents.push(params));

      // Act: Event with sessionId
      const event = createEvent('Page.frameNavigated', { frame: { id: 'f1' } }, 'session-123');
      mockWebSocket.simulateMessage(JSON.stringify(event));

      // Assert: Handler still invoked (sessionId doesn't affect event routing)
      assert.equal(receivedEvents.length, 1);
    });
  });
});
