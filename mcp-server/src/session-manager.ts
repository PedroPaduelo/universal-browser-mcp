/**
 * Session Manager - Maps MCP session IDs to browser session IDs
 * Each MCP client gets its own isolated browser session.
 */

import { randomUUID } from 'crypto';

interface SessionMapping {
  mcpSessionId: string;
  browserSessionId: string;
  createdAt: number;
}

export class SessionManager {
  private mappings: Map<string, SessionMapping> = new Map();

  /**
   * Creates a new browser session ID and maps it to the given MCP session ID.
   */
  createBrowserSession(mcpSessionId: string): string {
    const browserSessionId = `session_${randomUUID().slice(0, 8)}`;
    this.mappings.set(mcpSessionId, {
      mcpSessionId,
      browserSessionId,
      createdAt: Date.now()
    });
    console.error(`[SessionManager] Mapped MCP session ${mcpSessionId} -> browser session ${browserSessionId}`);
    return browserSessionId;
  }

  /**
   * Resolves an MCP session ID to its browser session ID.
   */
  getBrowserSessionId(mcpSessionId: string): string | null {
    return this.mappings.get(mcpSessionId)?.browserSessionId ?? null;
  }

  /**
   * Checks if a mapping exists for the given MCP session ID.
   */
  hasSession(mcpSessionId: string): boolean {
    return this.mappings.has(mcpSessionId);
  }

  /**
   * Removes the mapping for the given MCP session ID.
   */
  removeSession(mcpSessionId: string): void {
    const mapping = this.mappings.get(mcpSessionId);
    if (mapping) {
      console.error(`[SessionManager] Removed mapping for MCP session ${mcpSessionId} (browser: ${mapping.browserSessionId})`);
      this.mappings.delete(mcpSessionId);
    }
  }

  /**
   * Returns the number of active session mappings.
   */
  getActiveCount(): number {
    return this.mappings.size;
  }

  /**
   * Returns all active mappings info.
   */
  getAllMappings(): Array<{ mcpSessionId: string; browserSessionId: string; createdAt: number }> {
    return Array.from(this.mappings.values());
  }
}

/**
 * Helper to resolve a browser session from an MCP session ID.
 * Returns { browserSessionId } on success or { error } on failure.
 */
export function getSessionOrError(
  sessionManager: SessionManager,
  mcpSessionId: string | undefined
): { browserSessionId: string } | { error: string } {
  if (!mcpSessionId) {
    return { error: 'No MCP session ID available. This is an internal error.' };
  }

  const browserSessionId = sessionManager.getBrowserSessionId(mcpSessionId);
  if (!browserSessionId) {
    return { error: 'No active automation session. Use create_automation_session first.' };
  }

  return { browserSessionId };
}
