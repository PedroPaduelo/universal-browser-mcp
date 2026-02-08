import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager, getSessionOrError } from './session-manager.js';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe('createBrowserSession', () => {
    it('should create a new browser session', () => {
      const browserSessionId = manager.createBrowserSession('mcp-123');
      expect(browserSessionId).toMatch(/^session_[a-f0-9]{8}$/);
    });

    it('should create unique browser session IDs', () => {
      const id1 = manager.createBrowserSession('mcp-1');
      const id2 = manager.createBrowserSession('mcp-2');
      expect(id1).not.toBe(id2);
    });

    it('should map MCP session to browser session', () => {
      const browserSessionId = manager.createBrowserSession('mcp-123');
      expect(manager.getBrowserSessionId('mcp-123')).toBe(browserSessionId);
    });
  });

  describe('getBrowserSessionId', () => {
    it('should return null for unknown session', () => {
      expect(manager.getBrowserSessionId('nonexistent')).toBeNull();
    });

    it('should return browser session ID for known session', () => {
      const browserSessionId = manager.createBrowserSession('mcp-123');
      expect(manager.getBrowserSessionId('mcp-123')).toBe(browserSessionId);
    });
  });

  describe('hasSession', () => {
    it('should return false for unknown session', () => {
      expect(manager.hasSession('nonexistent')).toBe(false);
    });

    it('should return true for known session', () => {
      manager.createBrowserSession('mcp-123');
      expect(manager.hasSession('mcp-123')).toBe(true);
    });
  });

  describe('removeSession', () => {
    it('should remove an existing session', () => {
      manager.createBrowserSession('mcp-123');
      expect(manager.hasSession('mcp-123')).toBe(true);

      manager.removeSession('mcp-123');
      expect(manager.hasSession('mcp-123')).toBe(false);
      expect(manager.getBrowserSessionId('mcp-123')).toBeNull();
    });

    it('should not throw when removing nonexistent session', () => {
      expect(() => manager.removeSession('nonexistent')).not.toThrow();
    });
  });

  describe('getActiveCount', () => {
    it('should return 0 initially', () => {
      expect(manager.getActiveCount()).toBe(0);
    });

    it('should track active sessions', () => {
      manager.createBrowserSession('mcp-1');
      expect(manager.getActiveCount()).toBe(1);

      manager.createBrowserSession('mcp-2');
      expect(manager.getActiveCount()).toBe(2);

      manager.removeSession('mcp-1');
      expect(manager.getActiveCount()).toBe(1);
    });
  });

  describe('getAllMappings', () => {
    it('should return empty array initially', () => {
      expect(manager.getAllMappings()).toEqual([]);
    });

    it('should return all mappings', () => {
      manager.createBrowserSession('mcp-1');
      manager.createBrowserSession('mcp-2');

      const mappings = manager.getAllMappings();
      expect(mappings).toHaveLength(2);
      expect(mappings[0]).toHaveProperty('mcpSessionId', 'mcp-1');
      expect(mappings[0]).toHaveProperty('browserSessionId');
      expect(mappings[0]).toHaveProperty('createdAt');
      expect(mappings[1]).toHaveProperty('mcpSessionId', 'mcp-2');
    });
  });
});

describe('getSessionOrError', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('should return error when mcpSessionId is undefined', () => {
    const result = getSessionOrError(manager, undefined);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('No MCP session ID');
  });

  it('should return error when session does not exist', () => {
    const result = getSessionOrError(manager, 'nonexistent');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('No active automation session');
  });

  it('should return browserSessionId when session exists', () => {
    const browserSessionId = manager.createBrowserSession('mcp-123');
    const result = getSessionOrError(manager, 'mcp-123');
    expect(result).toHaveProperty('browserSessionId', browserSessionId);
  });
});
