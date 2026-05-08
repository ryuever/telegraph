/**
 * Unit tests for SessionRepository
 */

import assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionRepository } from '../SessionRepository';
import { Session } from '../../runtime/sessionManagement/Session';

describe('SessionRepository', () => {
  let tempDir: string;
  let repo: SessionRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
    repo = new SessionRepository(tempDir);
  });

  afterEach(async () => {
    // Clean up
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should save and retrieve a session', async () => {
    const session = new Session('test-session-1');
    session.addMessage('user', 'Hello, what is 2+2?');
    session.addMessage('assistant', 'The answer is 4.');

    await repo.saveSession(session);

    const retrieved = await repo.getSession('test-session-1');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.sessionId, 'test-session-1');
    assert.strictEqual(retrieved.messages.length, 2);
    assert.strictEqual(retrieved.messages[0].role, 'user');
    assert.strictEqual(retrieved.messages[0].content, 'Hello, what is 2+2?');
  });

  it('should preserve message metadata', async () => {
    const session = new Session('test-session-2');
    session.addMessage('user', 'Use the fetch tool', { source: 'ui' });
    session.addMessage('assistant', 'Fetching data...', { toolCalls: ['fetch-1'] });

    await repo.saveSession(session);

    const retrieved = await repo.getSession('test-session-2');
    assert.ok(retrieved);
    assert.deepStrictEqual(retrieved.messages[0].metadata, { source: 'ui' });
    assert.deepStrictEqual(retrieved.messages[1].metadata, { toolCalls: ['fetch-1'] });
  });

  it('should list all sessions', async () => {
    // Create multiple sessions
    const session1 = new Session('session-1');
    session1.addMessage('user', 'Message 1');
    await repo.saveSession(session1);

    const session2 = new Session('session-2');
    session2.addMessage('user', 'Message 2');
    await repo.saveSession(session2);

    const session3 = new Session('session-3');
    session3.addMessage('user', 'Message 3');
    await repo.saveSession(session3);

    const ids = await repo.listSessionIds();
    assert.strictEqual(ids.length, 3);
    assert(ids.includes('session-1'));
    assert(ids.includes('session-2'));
    assert(ids.includes('session-3'));
  });

  it('should support pagination', async () => {
    // Create 10 sessions
    for (let i = 0; i < 10; i++) {
      const session = new Session(`session-${i}`);
      session.addMessage('user', `Message ${i}`);
      await repo.saveSession(session);
    }

    // First page (5 items)
    const page1 = await repo.listSessionIds(5, 0);
    assert.strictEqual(page1.length, 5);

    // Second page (5 items)
    const page2 = await repo.listSessionIds(5, 5);
    assert.strictEqual(page2.length, 5);

    // No overlap
    for (const id of page1) {
      assert(!page2.includes(id));
    }
  });

  it('should delete a session', async () => {
    const session = new Session('to-delete');
    session.addMessage('user', 'This will be deleted');
    await repo.saveSession(session);

    assert.ok(await repo.getSession('to-delete'));

    await repo.deleteSession('to-delete');

    assert.strictEqual(await repo.getSession('to-delete'), null);
  });

  it('should return null for nonexistent session', async () => {
    const result = await repo.getSession('nonexistent');
    assert.strictEqual(result, null);
  });

  it('should get repository statistics', async () => {
    const session1 = new Session('sess-1');
    session1.addMessage('user', 'Hi');
    session1.addMessage('assistant', 'Hello');
    await repo.saveSession(session1);

    const session2 = new Session('sess-2');
    session2.addMessage('user', 'How are you?');
    await repo.saveSession(session2);

    const stats = repo.getStats();
    assert.strictEqual(stats.totalSessions, 2);
    assert.strictEqual(stats.totalMessages, 3); // 2 from session1 + 1 from session2
    assert.ok(stats.diskUsage > 0);
    assert.ok(stats.dataDir.includes('session-test-'));
  });

  it('should export a session as JSON', async () => {
    const session = new Session('to-export');
    session.addMessage('user', 'Export me');
    await repo.saveSession(session);

    const exported = await repo.exportSession('to-export');
    const parsed = JSON.parse(exported);

    assert.strictEqual(parsed.sessionId, 'to-export');
    assert.strictEqual(parsed.messages[0].content, 'Export me');
  });

  it('should import a session from JSON', async () => {
    const json = JSON.stringify({
      sessionId: 'imported',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [
        { role: 'user', content: 'Hello', ts: Date.now() },
        { role: 'assistant', content: 'Hi there', ts: Date.now() }
      ],
      metadata: {}
    });

    await repo.importSession(json);

    const imported = await repo.getSession('imported');
    assert.ok(imported);
    assert.strictEqual(imported.messages.length, 2);
    assert.strictEqual(imported.messages[0].content, 'Hello');
  });

  it('should sanitize session IDs for filenames', async () => {
    const session = new Session('session/with:special*chars');
    session.addMessage('user', 'Test');
    await repo.saveSession(session);

    // Should be retrievable despite special chars
    const retrieved = await repo.getSession('session/with:special*chars');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.sessionId, 'session/with:special*chars');
  });

  it('should handle concurrent saves', async () => {
    const sessions = [];
    for (let i = 0; i < 5; i++) {
      const session = new Session(`concurrent-${i}`);
      session.addMessage('user', `Message ${i}`);
      sessions.push(session);
    }

    // Save all concurrently
    await Promise.all(sessions.map(s => repo.saveSession(s)));

    // All should be saved
    const ids = await repo.listSessionIds(10, 0);
    assert.strictEqual(ids.length, 5);
  });

  it('should load index on initialization', async () => {
    // Create a session and save it
    const session1 = new Session('indexed-session');
    session1.addMessage('user', 'Indexed message');
    await repo.saveSession(session1);

    // Create a new repository instance (loads index from disk)
    const repo2 = new SessionRepository(tempDir);

    // Should find the previously saved session
    const retrieved = await repo2.getSession('indexed-session');
    assert.ok(retrieved);
    assert.strictEqual(retrieved.sessionId, 'indexed-session');
  });

  it('should clear all sessions', async () => {
    // Create sessions
    for (let i = 0; i < 3; i++) {
      const session = new Session(`session-${i}`);
      session.addMessage('user', `Message ${i}`);
      await repo.saveSession(session);
    }

    assert.strictEqual(repo.getSessionCount(), 3);

    // Clear
    await repo.clear();

    assert.strictEqual(repo.getSessionCount(), 0);
    const ids = await repo.listSessionIds();
    assert.strictEqual(ids.length, 0);
  });
});
