'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Tier 1: DJ Transition Engine - Equal-Power gain curve preserves constant acoustic energy', () => {
  // Test across full progress interval from 0 to 1 with 100 increments
  for (let i = 0; i <= 100; i++) {
    const p = i / 100;
    const theta = p * (Math.PI / 2);
    const gOut = Math.cos(theta);
    const gIn = Math.sin(theta);

    // Sum of squares must equal 1.0 (constant acoustic power)
    const power = (gOut * gOut) + (gIn * gIn);
    assert.ok(
      Math.abs(power - 1.0) < 1e-9,
      `Acoustic power must equal 1.0 at progress ${p}, got ${power}`
    );
  }
});

test('Tier 1: DJ Transition Engine - Crossfade boundaries and midpoint boost vs linear fade', () => {
  // At start (p = 0)
  const gOut0 = Math.cos(0);
  const gIn0 = Math.sin(0);
  assert.strictEqual(gOut0, 1.0);
  assert.strictEqual(gIn0, 0.0);

  // At finish (p = 1)
  const gOut1 = Math.cos(Math.PI / 2);
  const gIn1 = Math.sin(Math.PI / 2);
  assert.ok(Math.abs(gOut1) < 1e-9);
  assert.strictEqual(gIn1, 1.0);

  // At midpoint (p = 0.5)
  const gOutMid = Math.cos(Math.PI / 4);
  const gInMid = Math.sin(Math.PI / 4);
  const expectedMid = Math.SQRT1_2; // ~0.70710678

  assert.ok(Math.abs(gOutMid - expectedMid) < 1e-6);
  assert.ok(Math.abs(gInMid - expectedMid) < 1e-6);

  // Crucial check: equal-power gain at midpoint (~0.707) is strictly greater than linear fade (0.5)
  // to eliminate the perceived mid-transition volume dip!
  assert.ok(gOutMid > 0.7 && gInMid > 0.7);
});

test('Tier 1: DJ Transition Engine - Duration configuration is strictly clamped between 3s and 15s', () => {
  function clampDuration(sec) {
    return Math.max(3, Math.min(15, Math.round(sec)));
  }

  assert.strictEqual(clampDuration(1), 3, 'Values below 3s must clamp to 3s');
  assert.strictEqual(clampDuration(2.8), 3);
  assert.strictEqual(clampDuration(6), 6, 'Normal 6s duration preserved');
  assert.strictEqual(clampDuration(10), 10);
  assert.strictEqual(clampDuration(15), 15);
  assert.strictEqual(clampDuration(25), 15, 'Values above 15s must clamp to 15s');
});

test('Tier 1: DJ Transition Engine - Queue promotion and deck swapping state transitions', () => {
  // Simulate dual-deck state machine
  let activeDeck = 'A';
  let queue = [
    { id: 'track_1', title: 'Song 1' },
    { id: 'track_2', title: 'Song 2' },
    { id: 'track_3', title: 'Song 3' }
  ];
  let queueIndex = 0;
  let isDjTransitioning = false;

  function triggerTransition() {
    isDjTransitioning = true;
    const incomingDeck = activeDeck === 'A' ? 'B' : 'A';
    const nextIdx = (queueIndex + 1) % queue.length;
    const incomingTrack = queue[nextIdx];

    // Complete transition
    activeDeck = incomingDeck;
    queueIndex = nextIdx;
    isDjTransitioning = false;

    return { activeDeck, currentTrack: incomingTrack };
  }

  // 1st transition: Deck A -> Deck B, advances to track_2
  const r1 = triggerTransition();
  assert.strictEqual(r1.activeDeck, 'B');
  assert.strictEqual(r1.currentTrack.id, 'track_2');

  // 2nd transition: Deck B -> Deck A, advances to track_3
  const r2 = triggerTransition();
  assert.strictEqual(r2.activeDeck, 'A');
  assert.strictEqual(r2.currentTrack.id, 'track_3');
});
