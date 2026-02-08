import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BridgeServer } from './bridge-server.js';

describe('BridgeServer', () => {
  let server: BridgeServer;
  const TEST_PORT = 3099; // Use different port for tests

  beforeEach(() => {
    server = new BridgeServer(TEST_PORT, 'test-instance');
  });

  afterEach(async () => {
    try {
      server.stop();
    } catch {
      // ignore
    }
  });

  describe('constructor', () => {
    it('should create with custom instance ID', () => {
      expect(server.getInstanceId()).toBe('test-instance');
    });

    it('should generate instance ID if not provided', () => {
      const autoServer = new BridgeServer(TEST_PORT + 1);
      expect(autoServer.getInstanceId()).toMatch(/^mcp_/);
      autoServer.stop();
    });
  });

  describe('setInstanceId', () => {
    it('should update the instance ID', () => {
      server.setInstanceId('new-id');
      expect(server.getInstanceId()).toBe('new-id');
    });
  });

  describe('setCurrentSession', () => {
    it('should set the current session', () => {
      server.setCurrentSession('session_abc');
      expect(server.getCurrentSession()).toBe('session_abc');
    });
  });

  describe('getCurrentSession', () => {
    it('should return null initially', () => {
      expect(server.getCurrentSession()).toBeNull();
    });
  });

  describe('isBackgroundConnected', () => {
    it('should return false when not started', () => {
      expect(server.isBackgroundConnected()).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should return false when no session', () => {
      expect(server.isConnected()).toBe(false);
    });
  });

  describe('getConnectionCount', () => {
    it('should return 0 when not started', () => {
      expect(server.getConnectionCount()).toBe(0);
    });
  });

  describe('getConnectedSessions', () => {
    it('should return empty array when not started', () => {
      expect(server.getConnectedSessions()).toEqual([]);
    });

    it('should return current session in client mode', () => {
      server.setCurrentSession('session_test');
      // In non-server mode with a current session, it returns the session
      expect(server.getConnectedSessions()).toEqual(['session_test']);
    });
  });

  describe('getSessionsInfo', () => {
    it('should return empty array when not started', () => {
      expect(server.getSessionsInfo()).toEqual([]);
    });
  });

  describe('isServer', () => {
    it('should return false initially', () => {
      expect(server.isServer()).toBe(false);
    });
  });

  describe('getMcpClientCount', () => {
    it('should return 0 initially', () => {
      expect(server.getMcpClientCount()).toBe(0);
    });
  });

  describe('start', () => {
    it('should start as WebSocket server', async () => {
      await server.start();
      expect(server.isServer()).toBe(true);
    });

    it('should accept connections after starting', async () => {
      await server.start();
      expect(server.getConnectionCount()).toBe(0);
      expect(server.isBackgroundConnected()).toBe(false);
    });
  });

  describe('stop', () => {
    it('should stop cleanly after starting', async () => {
      await server.start();
      expect(server.isServer()).toBe(true);

      server.stop();
      // After stopping, connection count should be 0
      expect(server.getConnectionCount()).toBe(0);
    });

    it('should not throw when stopping without starting', () => {
      expect(() => server.stop()).not.toThrow();
    });
  });

  describe('sendAndWaitToSession', () => {
    it('should reject when no browser connected', async () => {
      await server.start();

      await expect(
        server.sendAndWaitToSession('session_123', { type: 'test' }, 1000)
      ).rejects.toThrow(/No browser connected/);
    });
  });

  describe('sendCommandToBackground', () => {
    it('should reject when background not connected', async () => {
      await server.start();

      await expect(
        server.sendCommandToBackground('test_command', {}, 1000)
      ).rejects.toThrow(/Background not connected/);
    });
  });

  describe('createSessionViaBackground', () => {
    it('should reject when background not connected', async () => {
      await server.start();

      await expect(
        server.createSessionViaBackground('session_test', 'https://example.com')
      ).rejects.toThrow(/Background not connected/);
    });
  });
});
