'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const dbMod = require('../../server/db.cjs');
const friendsMod = require('../../server/friends.cjs');

test('Tier 1: Unique Username System & Enhanced Friend Discovery', async (t) => {
  const db = dbMod.createTestDb();

  await t.test('1. Username Format Validation - Enforces 3-20 chars and [a-z0-9_]', () => {
    assert.strictEqual(dbMod.isUsernameAvailable('ab', null, db), false, 'Too short');
    assert.strictEqual(dbMod.isUsernameAvailable('a'.repeat(21), null, db), false, 'Too long');
    assert.strictEqual(dbMod.isUsernameAvailable('user name', null, db), false, 'Contains space');
    assert.strictEqual(dbMod.isUsernameAvailable('user@name!', null, db), false, 'Contains special chars');
    assert.strictEqual(dbMod.isUsernameAvailable('saatvik_99', null, db), true, 'Valid alphanumeric and underscore');
    assert.strictEqual(dbMod.isUsernameAvailable('@saatvik_99', null, db), true, 'Strips leading @ correctly');
  });

  await t.test('2. Claim Unique Username - Sets username in users table', () => {
    const res1 = dbMod.updateUserUsername('user_1', 'saatvik', db);
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.username, 'saatvik');

    const profile = dbMod.getUserByUserId('user_1', db);
    assert.ok(profile);
    assert.strictEqual(profile.username, 'saatvik');
  });

  await t.test('3. Case-Insensitive Uniqueness Collision - Rejects duplicates regardless of case', () => {
    // 'user_1' already has 'saatvik'
    const resUpper = dbMod.updateUserUsername('user_2', 'SAATVIK', db);
    assert.strictEqual(resUpper.success, false);
    assert.match(resUpper.error, /already taken/i);

    const resMixed = dbMod.updateUserUsername('user_3', 'Saatvik', db);
    assert.strictEqual(resMixed.success, false);
    assert.match(resMixed.error, /already taken/i);

    assert.strictEqual(dbMod.isUsernameAvailable('saatvik', null, db), false);
    assert.strictEqual(dbMod.isUsernameAvailable('SAATVIK', null, db), false);
  });

  await t.test('4. Update Own Username - Allows user to change their own username', () => {
    const resUpdate = dbMod.updateUserUsername('user_1', 'saatvik_parakh', db);
    assert.strictEqual(resUpdate.success, true);
    assert.strictEqual(resUpdate.username, 'saatvik_parakh');

    // The old username 'saatvik' should now be freed up
    assert.strictEqual(dbMod.isUsernameAvailable('saatvik', null, db), true);
  });

  await t.test('5. Real-Time Prefix Search - Finds users by typing partial name', () => {
    dbMod.updateUserUsername('user_alex', 'alex_beats', db);
    dbMod.updateUserUsername('user_alicia', 'alicia_keys', db);
    dbMod.updateUserUsername('user_bob', 'bob_listener', db);

    const results = dbMod.searchUsersByPrefix('al', null, 10, db);
    assert.strictEqual(results.length, 2);
    const usernames = results.map(u => u.username);
    assert.ok(usernames.includes('alex_beats'));
    assert.ok(usernames.includes('alicia_keys'));
    assert.ok(!usernames.includes('bob_listener'));

    // Exclude requester from search results
    const resultsExcluding = dbMod.searchUsersByPrefix('al', 'user_alex', 10, db);
    assert.strictEqual(resultsExcluding.length, 1);
    assert.strictEqual(resultsExcluding[0].username, 'alicia_keys');
  });

  await t.test('6. Friend Request with @ Prefix - Automatically normalizes and connects', () => {
    // Send request using '@alicia_keys'
    const req = friendsMod.sendFriendRequest('user_alex', '@alicia_keys', db);
    assert.ok(req);
    assert.strictEqual(req.status, 'pending');

    // Accept request
    const accepted = friendsMod.respondFriendRequest('user_alicia', 'user_alex', 'accepted', db);
    assert.strictEqual(accepted.status, 'accepted');

    // Check friends list
    const alexFriends = friendsMod.getFriends('user_alex', db);
    assert.strictEqual(alexFriends.length, 1);
    assert.strictEqual(alexFriends[0].username, 'alicia_keys');
  });

  db.close();
});
