/**
 * SessionRepository: Persistent storage for telegraph sessions
 * Implements a file-based backend (JSON) with optional SQLite migration in Phase 4
 * 
 * Interface design allows swapping backends without changing consumers
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Session, Message } from '../runtime/sessionManagement/Session';
import { createLogger } from '@/packages/services/log/node/logger'
const logger = createLogger('agent')

export interface StoredSession {
  sessionId: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  messages: StoredMessage[];
  metadata: Record<string, any>;
}

export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  ts: number; // milliseconds since epoch
  metadata?: Record<string, any>;
}

/**
 * File-based session repository
 * Stores sessions as JSON files in a directory
 * Thread-safe for concurrent reads via file locks (deferred to Phase 3.5)
 */
export class SessionRepository {
  private dataDir: string;
  private sessionIndex: Map<string, string> = new Map(); // sessionId -> filePath

  constructor(dataDir: string = path.join(process.cwd(), '.telegraph', 'sessions')) {
    this.dataDir = dataDir;
    this.ensureDataDir();
    this.loadIndex();
  }

  /**
   * Save or update a session
   */
  async saveSession(session: Session): Promise<void> {
    const stats = session.getStats();
    const stored: StoredSession = {
      sessionId: stats.sessionId,
      createdAt: new Date(stats.createdTs).toISOString(),
      updatedAt: new Date(stats.lastActivityTs).toISOString(),
      messages: session.getMessages().map(m => ({
        role: m.role,
        content: m.content,
        ts: m.ts,
        metadata: m.metadata
      })),
      metadata: {}
    };

    const filePath = this.getSessionFilePath(stats.sessionId);
    const content = JSON.stringify(stored, null, 2);

    // Write atomically with temp file
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tempPath, content, 'utf-8');
    await fs.promises.rename(tempPath, filePath);

    this.sessionIndex.set(stats.sessionId, filePath);
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<StoredSession | null> {
    const filePath = this.getSessionFilePath(sessionId);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const stored = JSON.parse(content) as StoredSession;
      return stored;
    } catch (error) {
      logger.error(`Failed to load session ${sessionId}`, error as Error);
      return null;
    }
  }

  /**
   * List all session IDs (optionally paginated)
   */
  async listSessionIds(limit = 50, offset = 0): Promise<string[]> {
    const ids = Array.from(this.sessionIndex.keys());

    // Sort by modification time (descending)
    const withStats: Array<[string, number]> = [];
    for (const id of ids) {
      const filePath = this.getSessionFilePath(id);
      try {
        const stat = fs.statSync(filePath);
        withStats.push([id, stat.mtimeMs]);
      } catch {
        // Session file no longer exists, skip
      }
    }

    withStats.sort((a, b) => b[1] - a[1]);
    return withStats.slice(offset, offset + limit).map(([id]) => id);
  }

  /**
   * List sessions with metadata (for UI)
   */
  async listSessions(limit = 50, offset = 0): Promise<StoredSession[]> {
    const ids = await this.listSessionIds(limit, offset);
    const sessions: StoredSession[] = [];

    for (const id of ids) {
      const session = await this.getSession(id);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const filePath = this.getSessionFilePath(sessionId);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }

    this.sessionIndex.delete(sessionId);
  }

  /**
   * Clear all sessions (for testing)
   */
  async clear(): Promise<void> {
    const files = fs.readdirSync(this.dataDir);
    for (const file of files) {
      if (file.endsWith('.json') && !file.endsWith('.index.json')) {
        const filePath = path.join(this.dataDir, file);
        await fs.promises.unlink(filePath);
      }
    }
    this.sessionIndex.clear();
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessionIndex.size;
  }

  /**
   * Get repository statistics
   */
  getStats(): {
    totalSessions: number;
    totalMessages: number;
    dataDir: string;
    diskUsage: number; // bytes
  } {
    let totalMessages = 0;
    let diskUsage = 0;

    const files = fs.readdirSync(this.dataDir);
    for (const file of files) {
      if (file.endsWith('.json') && !file.endsWith('.index.json')) {
        const filePath = path.join(this.dataDir, file);
        try {
          const stat = fs.statSync(filePath);
          diskUsage += stat.size;

          const content = fs.readFileSync(filePath, 'utf-8');
          const session = JSON.parse(content) as StoredSession;
          totalMessages += session.messages.length;
        } catch {
          // Skip unreadable files
        }
      }
    }

    return {
      totalSessions: this.sessionIndex.size,
      totalMessages,
      dataDir: this.dataDir,
      diskUsage
    };
  }

  /**
   * Export a session as JSON
   */
  async exportSession(sessionId: string): Promise<string> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return JSON.stringify(session, null, 2);
  }

  /**
   * Import a session from JSON
   */
  async importSession(jsonContent: string): Promise<StoredSession> {
    const session = JSON.parse(jsonContent) as StoredSession;

    // Validate structure
    if (!session.sessionId || !Array.isArray(session.messages)) {
      throw new Error('Invalid session JSON structure');
    }

    // Save to disk
    const filePath = this.getSessionFilePath(session.sessionId);
    await fs.promises.writeFile(filePath, jsonContent, 'utf-8');
    this.sessionIndex.set(session.sessionId, filePath);

    return session;
  }

  // ===== Private helpers =====

  private getSessionFilePath(sessionId: string): string {
    // Sanitize session ID for filename (replace non-alphanumeric)
    const sanitized = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.dataDir, `${sanitized}.json`);
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadIndex(): void {
    // Load session index from directory
    try {
      const files = fs.readdirSync(this.dataDir);
      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.index.json')) {
          // Extract session ID from filename
          const filePath = path.join(this.dataDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const session = JSON.parse(content) as StoredSession;
            this.sessionIndex.set(session.sessionId, filePath);
          } catch {
            logger.warn(`Failed to load session index from ${filePath}`);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load session index', error as Error);
    }
  }
}

/**
 * Migration utilities for future SQLite backend
 */
export namespace SessionRepositoryMigration {
  /**
   * Export all sessions as JSON Lines for migration
   */
  export async function exportAllAsJsonLines(repo: SessionRepository): Promise<string> {
    const stats = repo.getStats();
    const ids = await repo.listSessionIds(1000, 0);

    const lines: string[] = [];
    for (const id of ids) {
      const session = await repo.getSession(id);
      if (session) {
        lines.push(JSON.stringify(session));
      }
    }

    return lines.join('\n');
  }

  /**
   * Import JSON Lines into repository
   */
  export async function importFromJsonLines(
    repo: SessionRepository,
    content: string
  ): Promise<number> {
    const lines = content.trim().split('\n');
    let imported = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        await repo.importSession(line);
        imported++;
      } catch (error) {
        logger.error('Failed to import session', error as Error);
      }
    }

    return imported;
  }
}
