import assert from 'node:assert/strict';
import type { Track } from '../src/types/music.ts';
import {
  UtteranceDeduplicator,
  parseVoiceUtterance,
  rankVoiceTrackMatches,
  VoiceCommandEngine,
  type VoicePlaybackAdapter
} from '../src/services/voiceCommandParser.ts';

function makeTrack(id: string, title: string, artist: string, album = ''): Track {
  return {
    id,
    title,
    artist,
    album,
    duration: 210,
    filePath: '',
    artworkUrl: null,
    hasArtwork: false
  };
}

function createMockHarness(opts?: {
  localTracks?: Track[];
  onlineTracks?: Track[];
  searchDelayMs?: number;
  online?: boolean;
}) {
  const calls: string[] = [];
  const queue: Track[] = [];
  const spoken: string[] = [];
  let playing = true;

  const adapter: VoicePlaybackAdapter = {
    pause: () => {
      playing = false;
      calls.push('pause');
    },
    resume: () => {
      playing = true;
      calls.push('resume');
    },
    skip: () => {
      calls.push('skip');
    },
    previous: () => {
      calls.push('previous');
    },
    playTrack: (t) => {
      playing = true;
      calls.push(`play:${t.id}`);
    },
    playNext: (t) => {
      queue.unshift(t);
      calls.push(`play_next:${t.id}`);
    },
    addToQueue: (t) => {
      queue.push(t);
      calls.push(`add_to_queue:${t.id}`);
    },
    isPlaying: () => playing,
    getLocalLibraryTracks: () => opts?.localTracks ?? [],
    searchCatalog: async () => {
      calls.push('searchCatalog');
      if (opts?.searchDelayMs) {
        await new Promise((r) => setTimeout(r, opts.searchDelayMs));
      }
      return opts?.onlineTracks ?? [];
    },
    isOnline: () => opts?.online ?? true,
    speak: async (text) => {
      spoken.push(text);
    }
  };

  const engine = new VoiceCommandEngine(adapter);
  return {
    engine,
    calls,
    queue,
    spoken,
    get isPlaying() {
      return playing;
    }
  };
}

async function runTests() {
  // 1. Single commands
  {
    const p1 = parseVoiceUtterance('Hey Lumen, pause this song');
    assert.equal(p1.wakeDetected, true);
    assert.deepEqual(p1.actions, [{ type: 'pause' }]);

    const p2 = parseVoiceUtterance('keep playing');
    assert.deepEqual(p2.actions, [{ type: 'resume' }]);

    const p3 = parseVoiceUtterance('skip this song');
    assert.deepEqual(p3.actions, [{ type: 'skip' }]);

    const p4 = parseVoiceUtterance('play Blinding Lights by The Weeknd next');
    assert.equal(p4.actions.length, 1);
    assert.equal(p4.actions[0].type, 'play_next');
    if (p4.actions[0].type === 'play_next') {
      assert.equal(p4.actions[0].query.title, 'Blinding Lights');
      assert.equal(p4.actions[0].query.artist, 'The Weeknd');
    }

    const p5 = parseVoiceUtterance('cancel');
    assert.deepEqual(p5.actions, [{ type: 'cancel' }]);
  }

  // 2. Titles & artists containing "and" and "by"
  {
    const standByMe = parseVoiceUtterance('add Stand by Me by Ben E. King to my queue');
    assert.equal(standByMe.actions.length, 1);
    assert.equal(standByMe.actions[0].type, 'add_to_queue');
    if (standByMe.actions[0].type === 'add_to_queue') {
      assert.equal(standByMe.actions[0].query.title, 'Stand by Me');
      assert.equal(standByMe.actions[0].query.artist, 'Ben E. King');
    }

    const sweetDreams = parseVoiceUtterance('add Sweet Dreams by Eurythmics to my queue');
    assert.equal(sweetDreams.actions.length, 1);
    assert.equal(sweetDreams.actions[0].type, 'add_to_queue');
    if (sweetDreams.actions[0].type === 'add_to_queue') {
      assert.equal(sweetDreams.actions[0].query.title, 'Sweet Dreams');
      assert.equal(sweetDreams.actions[0].query.artist, 'Eurythmics');
    }

    const simonAndGarfunkel = parseVoiceUtterance('play The Sound of Silence by Simon and Garfunkel');
    assert.equal(simonAndGarfunkel.actions.length, 1);
    assert.equal(simonAndGarfunkel.actions[0].type, 'play');
    if (simonAndGarfunkel.actions[0].type === 'play') {
      assert.equal(simonAndGarfunkel.actions[0].query.title, 'The Sound of Silence');
      assert.equal(simonAndGarfunkel.actions[0].query.artist, 'Simon and Garfunkel');
    }
  }

  // 3. Compound command: pause runs IMMEDIATELY before async catalog search, and playback stays PAUSED
  {
    const blinding = makeTrack('t_blinding', 'Blinding Lights', 'The Weeknd', 'After Hours');
    const h = createMockHarness({ onlineTracks: [blinding], searchDelayMs: 25 });
    const res = await h.engine.handleTranscript({
      text: 'Hey Lumen, pause this song and add Blinding Lights by The Weeknd to my queue',
      utteranceId: 'u-compound-1'
    });

    assert.equal(h.calls[0], 'pause', 'Pause must execute immediately before catalog lookup');
    assert.equal(h.calls[1], 'searchCatalog');
    assert.equal(h.calls[2], 'add_to_queue:t_blinding');
    assert.equal(h.isPlaying, false, 'Adding a song to queue must NEVER resume paused playback');
    assert.equal(h.queue.length, 1);
    assert.equal(h.queue[0].id, 't_blinding');
    assert.ok(res.spokenFeedback?.includes('Paused.'));
    assert.ok(res.spokenFeedback?.includes('Blinding Lights'));
  }

  // 4. Compound command with missing song: pause still sticks, graceful spoken failure
  {
    const h = createMockHarness({ onlineTracks: [] });
    const res = await h.engine.handleTranscript({
      text: 'Hey Lumen, pause this song and add Nonexistent Imaginary Track by Nobody to my queue',
      utteranceId: 'u-compound-miss'
    });

    assert.equal(h.isPlaying, false);
    assert.equal(h.queue.length, 0);
    assert.equal(res.spokenFeedback, "Paused. I couldn't find that song.");
  }

  // 5. Duplicate recognition callbacks ignored, deliberate repeat later accepted
  {
    const dedup = new UtteranceDeduplicator(2000);
    assert.equal(dedup.shouldIgnore('skip this song', 1000, 'u1'), false);
    assert.equal(dedup.shouldIgnore('skip this song', 1200, 'u1'), true);
    assert.equal(dedup.shouldIgnore('skip this song', 1500, 'u2'), true);
    assert.equal(dedup.shouldIgnore('skip this song', 3500, 'u3'), false);
  }

  // 6. Ambiguous studio vs live version triggers spoken clarification and follow-up resolution
  {
    const studio = makeTrack('t_hotel_studio', 'Hotel California', 'Eagles', 'Hotel California');
    const live = makeTrack('t_hotel_live', 'Hotel California (Live)', 'Eagles', 'Hell Freezes Over');
    const ranked = rankVoiceTrackMatches(
      { title: 'Hotel California', artist: 'Eagles', rawQuery: 'Hotel California by Eagles', versionHint: null },
      [studio, live]
    );
    assert.ok(ranked.ambiguousPair, 'Close studio vs live candidates should trigger clarification');

    const h = createMockHarness({ onlineTracks: [studio, live] });
    const first = await h.engine.handleTranscript({
      text: 'add Hotel California by Eagles to my queue',
      utteranceId: 'u-ambig-1'
    });
    assert.equal(h.queue.length, 0, 'Should wait for user version choice before queueing');
    assert.ok(first.spokenFeedback?.toLowerCase().includes('studio'));
    assert.ok(first.spokenFeedback?.toLowerCase().includes('live'));

    // User answers without needing a second wake phrase
    const followUp = await h.engine.handleTranscript({
      text: 'the live version',
      utteranceId: 'u-ambig-2'
    });
    assert.equal(h.queue.length, 1);
    assert.equal(h.queue[0].id, 't_hotel_live');
    assert.ok(followUp.spokenFeedback?.includes('Hotel California (Live)'));
  }

  // 7. Cancel during async lookup aborts without modifying queue
  {
    const song = makeTrack('t_slow', 'Dreams', 'Fleetwood Mac');
    const h = createMockHarness({ onlineTracks: [song], searchDelayMs: 60 });
    const pending = h.engine.handleTranscript({
      text: 'add Dreams by Fleetwood Mac to my queue',
      utteranceId: 'u-slow-1'
    });
    await new Promise((r) => setTimeout(r, 15));
    await h.engine.handleTranscript({
      text: 'cancel',
      utteranceId: 'u-cancel-1'
    });
    await pending;
    assert.equal(h.queue.length, 0, 'Canceled lookup must not append track to queue');
  }

  // 8. Stale utterance (>15s old) is ignored so locked-screen commands never replay late
  {
    const h = createMockHarness();
    const res = await h.engine.handleTranscript({
      text: 'Hey Lumen, skip this song',
      utteranceId: 'u-stale',
      timestampMs: 1000,
      nowMs: 25000
    });
    assert.equal(res.executedActions.length, 0);
    assert.equal(h.calls.length, 0);
  }

  // 9. Offline behavior: finds local library songs, reports honest offline miss for remote-only tracks
  {
    const localSong = makeTrack('t_local', 'Nangs', 'Tame Impala', 'Currents');
    const h = createMockHarness({ localTracks: [localSong], online: false });
    const found = await h.engine.handleTranscript({
      text: 'add Nangs by Tame Impala to my queue',
      utteranceId: 'u-off-1'
    });
    assert.equal(h.queue.length, 1);
    assert.equal(h.queue[0].id, 't_local');
    assert.ok(found.spokenFeedback?.includes('Nangs'));

    const missed = await h.engine.handleTranscript({
      text: 'add Starboy by The Weeknd to my queue',
      utteranceId: 'u-off-2'
    });
    assert.equal(h.queue.length, 1);
    assert.ok(missed.spokenFeedback?.toLowerCase().includes('offline'));
  }

  console.log('ALL 9 VOICE COMMAND PARSER & CONTROLLER TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('VOICE COMMAND TEST FAILED:', err);
  process.exit(1);
});
