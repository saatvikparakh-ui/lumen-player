'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { searchCatalog, parseQueryIntent, rankCandidate } = require('../../server/searchEngine.cjs');
const { scoreCandidate, matchTrack, normalize } = require('../../server/trackMatcher.cjs');

describe('Tier 1: Search Engine - Intent Understanding & Ranking', () => {
  it('parses acoustic modifier from query', () => {
    const intent = parseQueryIntent('the acoustic version of Hotel California');
    assert.equal(intent.versionModifier, 'acoustic');
    assert.equal(intent.cleanQuery.toLowerCase(), 'hotel california');
  });

  it('parses decade and genre from natural language query', () => {
    const intent = parseQueryIntent('upbeat indie rock from the 2000s');
    assert.equal(intent.decade, 2000);
    assert.equal(intent.genre, 'indie rock');
    assert.equal(intent.cleanQuery.toLowerCase(), 'upbeat');
  });

  it('parses context recommendation intent', () => {
    const intent = parseQueryIntent('songs like Starboy');
    assert.equal(intent.isContextRecommendation, true);
    assert.equal(intent.contextSeed, 'Starboy');
  });

  it('ranks exact title and artist combo higher than partial matches', () => {
    const intent = parseQueryIntent('Starboy The Weeknd');
    const candExact = { title: 'Starboy (feat. Daft Punk)', artist: 'The Weeknd', album: 'Starboy' };
    const candOther = { title: 'Starboy', artist: 'Rockabye Baby!', album: 'Lullaby' };

    const scoreExact = rankCandidate(candExact, intent).score;
    const scoreOther = rankCandidate(candOther, intent).score;

    assert.ok(scoreExact > scoreOther, `Exact combo (${scoreExact}) should beat mismatched artist (${scoreOther})`);
  });
});

describe('Tier 1: Track Matcher - High-Precision Candidate Scoring', () => {
  it('strictly rejects candidates with completely mismatched artist', () => {
    const input = { title: 'Losers', artist: 'The Weeknd', album: 'Beauty Behind the Madness' };
    const candWrong = { trackName: 'Losers', artistName: 'Post Malone', collectionName: 'F-1 Trillion' };

    const score = scoreCandidate(input, candWrong);
    assert.equal(score, -999, 'Wrong artist must be rejected with -999 score');
  });

  it('favors original studio recording over remix when remix was not requested', () => {
    const input = { title: 'The Less I Know The Better', artist: 'Tame Impala', album: 'Currents' };
    const candStudio = { trackName: 'The Less I Know The Better', artistName: 'Tame Impala', collectionName: 'Currents' };
    const candRemix = { trackName: 'The Less I Know The Better (SAINT WKND Remix)', artistName: 'Tame Impala', collectionName: 'Remixes' };

    const scoreStudio = scoreCandidate(input, candStudio);
    const scoreRemix = scoreCandidate(input, candRemix);

    assert.ok(scoreStudio > scoreRemix + 50, `Studio (${scoreStudio}) must heavily outscore remix (${scoreRemix})`);
  });

  it('matches "Losers" by The Weeknd to the authentic studio release', async () => {
    const matched = await matchTrack({ title: 'Losers', artist: 'The Weeknd', album: 'Beauty Behind the Madness' });
    assert.ok(matched.artist.toLowerCase().includes('the weeknd'), 'Must match The Weeknd');
    assert.ok(matched.title.toLowerCase().includes('losers'), 'Must match Losers');
    assert.equal(matched.isVerified, true);
  });
});
