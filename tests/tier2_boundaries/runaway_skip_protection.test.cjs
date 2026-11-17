'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('Runaway Skip Protection - Sliding window rate limiter pauses after 5 rapid skips within 5s', () => {
  let isPaused = false;
  let recentTimestamps = [];
  const pause = () => { isPaused = true; };

  function simulateNext(now) {
    recentTimestamps = recentTimestamps.filter(t => now - t < 5000);
    recentTimestamps.push(now);
    if (recentTimestamps.length >= 5) {
      recentTimestamps = [];
      pause();
      return;
    }
  }

  // 4 skips over 3 seconds (each skip 800ms apart, like network resolution)
  simulateNext(1000);
  assert.strictEqual(isPaused, false, 'Should not pause after 1st skip');
  simulateNext(1800);
  assert.strictEqual(isPaused, false, 'Should not pause after 2nd skip');
  simulateNext(2600);
  assert.strictEqual(isPaused, false, 'Should not pause after 3rd skip');
  simulateNext(3400);
  assert.strictEqual(isPaused, false, 'Should not pause after 4th skip');
  
  // 5th skip at 4200ms (all 5 within 5000ms window)
  simulateNext(4200);
  assert.strictEqual(isPaused, true, 'Should immediately pause on 5th skip within 5s');
});

test('Runaway Skip Protection - Debounce ignores calls within 200ms window', () => {
  let callCount = 0;
  let lastCall = 0;

  function simulateNext(now) {
    if (now - lastCall < 200) {
      return;
    }
    lastCall = now;
    callCount++;
  }

  simulateNext(1000);
  simulateNext(1050); // within 50ms - debounced
  simulateNext(1120); // within 120ms - debounced
  assert.strictEqual(callCount, 1, 'Duplicate event triggers within 200ms must be ignored');

  simulateNext(1250); // after 250ms - allowed
  assert.strictEqual(callCount, 2, 'Legitimate skip after 250ms must be processed');
});

test('Cascade Protection - 3 consecutive immediate ends (< 2s) halts auto-skipping', () => {
  let consecutiveImmediateEnds = 0;
  let isPaused = false;
  let nextCalled = 0;

  function handleTrackEnded(accumulatedSeconds) {
    if (accumulatedSeconds < 2) {
      consecutiveImmediateEnds++;
      if (consecutiveImmediateEnds >= 3) {
        consecutiveImmediateEnds = 0;
        isPaused = true;
        return;
      }
    } else {
      consecutiveImmediateEnds = 0;
    }
    nextCalled++;
  }

  // Track 1 ends after 0.5s
  handleTrackEnded(0.5);
  assert.strictEqual(isPaused, false);
  assert.strictEqual(nextCalled, 1);

  // Track 2 ends after 0.2s
  handleTrackEnded(0.2);
  assert.strictEqual(isPaused, false);
  assert.strictEqual(nextCalled, 2);

  // Track 3 ends after 0.4s -> 3rd immediate end halts cascade!
  handleTrackEnded(0.4);
  assert.strictEqual(isPaused, true, 'Must pause on 3rd consecutive immediate end');
  assert.strictEqual(nextCalled, 2, 'Must not call next() after cascade protection triggers');
});

test('Cascade Protection - Normal playback (>= 2s) resets consecutive failure counter', () => {
  let consecutiveImmediateEnds = 0;
  let isPaused = false;
  let nextCalled = 0;

  function handleTrackEnded(accumulatedSeconds) {
    if (accumulatedSeconds < 2) {
      consecutiveImmediateEnds++;
      if (consecutiveImmediateEnds >= 3) {
        consecutiveImmediateEnds = 0;
        isPaused = true;
        return;
      }
    } else {
      consecutiveImmediateEnds = 0;
    }
    nextCalled++;
  }

  // Track 1 fails immediately
  handleTrackEnded(0.5);
  assert.strictEqual(consecutiveImmediateEnds, 1);

  // Track 2 plays for 150 seconds (healthy playback)
  handleTrackEnded(150);
  assert.strictEqual(consecutiveImmediateEnds, 0, 'Healthy playback must reset failure counter');

  // Track 3 fails immediately
  handleTrackEnded(0.3);
  assert.strictEqual(consecutiveImmediateEnds, 1);
  assert.strictEqual(isPaused, false);
});
