'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTestDb,
  seedUser
} = require('../fixtures/testDb.cjs');

test('Tier 2: Bidirectional Constraints - Reversing pair (A,B) vs (B,A) strictly rejected by database UNIQUE(user_low, user_high)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const stmt = db.prepare(`
    INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // First direction: Alice -> Bob
  stmt.run('u_alice', 'u_bob', 'pending', 1000, 1000);

  // Exact duplicate: Alice -> Bob
  assert.throws(
    () => stmt.run('u_alice', 'u_bob', 'pending', 2000, 2000),
    /UNIQUE constraint failed/i,
    'Duplicate (A, B) must violate unique constraint'
  );

  // Reversed duplicate: Bob -> Alice
  assert.throws(
    () => stmt.run('u_bob', 'u_alice', 'pending', 2000, 2000),
    /UNIQUE constraint failed/i,
    'Reversed pair (B, A) must violate unique constraint on (user_low, user_high)'
  );
});

test('Tier 2: Bidirectional Constraints - Self-friendship strictly rejected by CHECK(requester_id <> recipient_id)', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });

  const stmt = db.prepare(`
    INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  assert.throws(
    () => stmt.run('u_alice', 'u_alice', 'pending', 1000, 1000),
    /CHECK constraint failed/i,
    'Self-friendship must fail CHECK constraint'
  );
});

test('Tier 2: Bidirectional Constraints - Invalid status rejected by CHECK(status IN (...))', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const stmt = db.prepare(`
    INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  assert.throws(
    () => stmt.run('u_alice', 'u_bob', 'blocked', 1000, 1000),
    /CHECK constraint failed/i,
    'Invalid status must fail CHECK constraint'
  );
  assert.throws(
    () => stmt.run('u_alice', 'u_bob', 'active', 1000, 1000),
    /CHECK constraint failed/i
  );
});

test('Tier 2: Bidirectional Constraints - Foreign key constraints and ON DELETE CASCADE', (t) => {
  const db = createTestDb();
  seedUser(db, { userId: 'u_alice', username: 'alice' });
  seedUser(db, { userId: 'u_bob', username: 'bob' });

  const stmt = db.prepare(`
    INSERT INTO friendships (requester_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Foreign key failure with non-existent user
  assert.throws(
    () => stmt.run('u_alice', 'u_ghost', 'pending', 1000, 1000),
    /FOREIGN KEY constraint failed/i,
    'Friendship with non-existent user must fail foreign key constraint'
  );

  // Insert valid friendship
  stmt.run('u_alice', 'u_bob', 'accepted', 1000, 1000);
  assert.strictEqual(db.prepare('SELECT COUNT(*) as cnt FROM friendships').get().cnt, 1);

  // Delete Alice -> should cascade and delete friendship
  db.prepare('DELETE FROM users WHERE user_id = ?').run('u_alice');
  assert.strictEqual(db.prepare('SELECT COUNT(*) as cnt FROM friendships').get().cnt, 0, 'Cascade delete must remove friendship');
});
