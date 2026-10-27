'use strict';

const dbModule = require('./db.cjs');
const defaultFriendsModule = require('./friends.cjs');

function resolveDb(db) {
  if (db && typeof db.prepare === 'function') {
    return db;
  }
  return dbModule.getDb();
}

/**
 * Creates recommendation service with explicit db and friends service dependency injection.
 */
function createRecommendationsService(db, friendsService = null) {
  const activeDb = resolveDb(db);
  const activeFriends = friendsService || defaultFriendsModule.createFriendsService(activeDb);

  return {
    getRecommendedTracks(userId, baseRecommendations = []) {
      // 1. High-rating boost: find artists user rated >= 8.5 (rating_tenths >= 85)
      const highRatedStmt = activeDb.prepare(`
        SELECT DISTINCT s.artist, MAX(r.rating_tenths) as max_tenths
        FROM ratings r
        JOIN songs s ON r.song_id = s.song_id
        WHERE r.user_id = ? AND r.rating_tenths >= 85
        GROUP BY s.artist
        ORDER BY max_tenths DESC
      `);
      const boostedArtists = highRatedStmt.all(userId).map(r => r.artist).filter(Boolean);

      // 2. Friend recommendations shelf: tracks rated >= 8.5 by accepted friends that user has not heard
      const friends = activeFriends.getFriends(userId);
      const friendIds = friends.map(f => f.user_id);

      let friendRecommendations = [];
      if (friendIds.length > 0) {
        const placeholders = friendIds.map(() => '?').join(',');
        const friendRecsStmt = activeDb.prepare(`
          SELECT DISTINCT s.song_id, s.title, s.artist, s.album,
                 r.rating_tenths as friend_tenths,
                 printf('%.1f', r.rating_tenths / 10.0) as friend_rating,
                 u.username as friend_username
          FROM ratings r
          JOIN songs s ON r.song_id = s.song_id
          JOIN users u ON r.user_id = u.user_id
          WHERE r.user_id IN (${placeholders})
            AND r.rating_tenths >= 85
            AND s.song_id NOT IN (SELECT song_id FROM ratings WHERE user_id = ?)
            AND s.song_id NOT IN (SELECT song_id FROM playback_events WHERE user_id = ?)
          ORDER BY r.rating_tenths DESC
          LIMIT 20
        `);
        friendRecommendations = friendRecsStmt.all(...friendIds, userId, userId);
      }

      // 3. Re-rank base recommendations: boost boostedArtists to top
      const boostedRecommendations = [...baseRecommendations].sort((a, b) => {
        const aBoost = boostedArtists.includes(a.artist) ? 1 : 0;
        const bBoost = boostedArtists.includes(b.artist) ? 1 : 0;
        return bBoost - aBoost;
      });

      return {
        boostedArtists,
        recommendations: boostedRecommendations,
        friendRecommendations
      };
    }
  };
}

module.exports = {
  createRecommendationsService,
  resolveDb,
  getRecommendedTracks(userId, baseRecommendations = [], db = null) {
    const service = createRecommendationsService(db);
    return service.getRecommendedTracks(userId, baseRecommendations);
  }
};
