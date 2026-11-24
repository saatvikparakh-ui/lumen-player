import { 
  AlbumClub, 
  ClubMember, 
  WeeklyCycle, 
  AlbumNomination, 
  MemberReview, 
  ClubCycleVerdict,
  ClubTrack
} from '../types/albumClubTypes';
import { GeminiService } from './geminiService';
import { FirestoreService } from './firestoreService';
import { SupabaseService } from './supabaseService';

const STORAGE_KEY_ALBUM_CLUBS = 'lumen_weekly_album_clubs_v2';
const STORAGE_KEY_ACTIVE_CLUB = 'lumen_active_album_club_id_v2';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class AlbumClubService {
  /**
   * Retrieves all saved Album Clubs from local storage with schema safety.
   */
  public static getClubs(currentUserId?: string): AlbumClub[] {
    try {
      // Purge legacy storage keys
      localStorage.removeItem('lumen_weekly_album_clubs');
      localStorage.removeItem('lumen_weekly_album_clubs_v1');
      if (localStorage.getItem(STORAGE_KEY_ACTIVE_CLUB) === 'club_velvet_coast') {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_CLUB);
      }

      const raw = localStorage.getItem(STORAGE_KEY_ALBUM_CLUBS);
      if (raw) {
        let clubs: AlbumClub[] = JSON.parse(raw);
        if (Array.isArray(clubs) && clubs.length > 0) {
          // Strictly purge any legacy seed mock clubs and fake friends
          clubs = clubs.filter(c => 
            c && 
            c.id !== 'club_velvet_coast' && 
            !c.id.startsWith('seed_') &&
            c.name !== 'Late Night Vinyl' && 
            c.createdBy !== 'maya'
          );
          if (clubs.length > 0) {
            return clubs.map(club => this.evaluateCycleStage(club));
          } else {
            localStorage.removeItem(STORAGE_KEY_ALBUM_CLUBS);
            localStorage.removeItem(STORAGE_KEY_ACTIVE_CLUB);
          }
        }
      }
    } catch (e) {
      console.warn('Error reading album clubs from storage:', e);
    }

    // No clubs exist by default until the user creates one with their friends
    return [];
  }

  /**
   * Delete an album club completely
   */
  public static deleteClub(clubId: string): boolean {
    try {
      const clubs = this.getClubs().filter(c => c.id !== clubId);
      this.saveAllClubs(clubs);
      const active = this.getActiveClubId();
      if (active === clubId) {
        this.setActiveClubId(clubs[0]?.id || '');
      }
      return true;
    } catch (e) {
      console.warn('Error deleting album club:', e);
      return false;
    }
  }

  /**
   * Remove/reset current cycle nomination so a new album can be picked
   */
  public static deleteNomination(clubId: string): AlbumClub | null {
    try {
      const club = this.getClubById(clubId);
      if (!club || !club.currentCycle) return null;
      club.currentCycle.nomination = null;
      club.currentCycle.stage = 'nominate';
      club.currentCycle.memberProgress = {};
      club.currentCycle.secretReviews = {};
      club.currentCycle.verdict = null;
      this.saveClub(club);
      return club;
    } catch (e) {
      console.warn('Error deleting album nomination:', e);
      return null;
    }
  }

  /**
   * Saves all clubs to local storage and updates active selection
   */
  public static saveAllClubs(clubs: AlbumClub[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_ALBUM_CLUBS, JSON.stringify(clubs));
    } catch (e) {
      console.warn('Error saving album clubs:', e);
    }
  }

  /**
   * Retrieves or updates a specific club
   */
  public static getClubById(clubId: string, currentUserId?: string): AlbumClub | null {
    const clubs = this.getClubs(currentUserId);
    return clubs.find(c => c.id === clubId) || null;
  }

  public static saveClub(updatedClub: AlbumClub, broadcastToCloud: boolean = true): void {
    const evaluated = this.evaluateCycleStage(updatedClub);
    const clubs = this.getClubs();
    const idx = clubs.findIndex(c => c.id === evaluated.id);
    if (idx >= 0) {
      clubs[idx] = evaluated;
    } else {
      clubs.unshift(evaluated);
    }
    this.saveAllClubs(clubs);
    if (broadcastToCloud) {
      // Realtime sync to Supabase Realtime & Cloud Firestore
      SupabaseService.broadcastClubUpdate(evaluated.id, evaluated);
      FirestoreService.saveAlbumClub(evaluated).catch(() => {});
    }
  }

  /**
   * Get Active Club ID
   */
  public static getActiveClubId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY_ACTIVE_CLUB) || null;
    } catch (_) {
      return null;
    }
  }

  public static setActiveClubId(clubId: string): void {
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_CLUB, clubId);
    } catch (_) {}
  }

  public static getActiveClub(myId?: string): AlbumClub | null {
    const id = this.getActiveClubId();
    if (id) {
      const c = this.getClubById(id, myId);
      if (c) return c;
    }
    const all = this.getClubs(myId);
    return all.length > 0 ? all[0] : null;
  }

  /**
   * Checks the 7-day countdown. If the timer has elapsed and stage is still 'listen',
   * automatically seals submissions, calculates group verdict, and transitions to 'reveal'.
   */
  public static evaluateCycleStage(club: AlbumClub): AlbumClub {
    const cycle = club.currentCycle;
    if (!cycle) return club;

    const now = Date.now();
    // If we're in listen stage and the 7-day countdown has expired
    if (cycle.stage === 'listen' && now >= cycle.cycleEndTimestamp) {
      // Seal & compute verdict
      const verdict = this.calculateVerdict(cycle);
      const updatedCycle: WeeklyCycle = {
        ...cycle,
        stage: 'reveal',
        verdict
      };

      const updatedClub = {
        ...club,
        currentCycle: updatedCycle
      };

      // Trigger AI summary in background
      this.enrichVerdictWithAi(updatedClub);
      return updatedClub;
    }

    return club;
  }

  /**
   * Create a new Album Club
   */
  public static createClub(
    name: string,
    description: string,
    currentUser: { uid?: string; id?: string; username?: string | null; displayName?: string | null; photoURL?: string | null },
    friendMembers: Array<{ userId?: string; id?: string; username?: string; displayName?: string; avatarUrl?: string }>
  ): AlbumClub {
    const clubId = `club_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const myId = currentUser.uid || currentUser.id || 'current_user';
    const myUsername = currentUser.username || 'me';
    const myDisplayName = currentUser.displayName || myUsername;

    const members: ClubMember[] = [
      {
        id: myId,
        username: myUsername,
        displayName: myDisplayName,
        avatarUrl: currentUser.photoURL || null,
        isCurator: true,
        hasListened: false,
        hasSubmitted: false,
        joinedAt: Date.now()
      }
    ];

    friendMembers.forEach(f => {
      const fId = f.userId || f.id || `friend_${Math.random()}`;
      if (fId !== myId) {
        members.push({
          id: fId,
          username: f.username || 'friend',
          displayName: f.displayName || f.username || 'Friend',
          avatarUrl: f.avatarUrl || null,
          isCurator: false,
          hasListened: false,
          hasSubmitted: false,
          joinedAt: Date.now()
        });
      }
    });

    const now = Date.now();
    const newClub: AlbumClub = {
      id: clubId,
      name: name.trim() || 'Weekly Album Club',
      description: description.trim() || 'One album every 7 days. Listen together, rate secretly.',
      createdBy: myId,
      createdAt: now,
      curatorRotationIndex: 0,
      members,
      currentCycle: {
        weekNumber: 1,
        stage: 'nominate',
        curatorMemberId: myId,
        curatorUsername: myUsername,
        cycleStartTimestamp: now,
        cycleEndTimestamp: now + SEVEN_DAYS_MS,
        nomination: null,
        memberProgress: {
          [myId]: { listenedTrackIds: [], hasSubmitted: false }
        },
        secretReviews: {},
        verdict: null
      },
      archive: []
    };

    this.saveClub(newClub);
    this.setActiveClubId(newClub.id);

    // Broadcast invite to friend members in real time via Supabase (<50ms) and Firestore fallback using ONE deterministic ID
    friendMembers.forEach(f => {
      const fId = f.userId || f.id;
      const cleanU = (f.username || '').replace(/^@/, '').trim().toLowerCase();
      if (fId && fId !== myId) {
        const shareId = `share_club_${newClub.id}_${fId || cleanU}`;
        SupabaseService.sendAlbumClubInvite({
          id: shareId,
          club_id: newClub.id,
          club_name: newClub.name,
          inviter_id: myId,
          inviter_name: myUsername,
          invitee_id: fId,
          invitee_name: cleanU || f.displayName,
          club: newClub
        }).catch(() => {});
        FirestoreService.sendAlbumClubInvite(currentUser as any, fId, cleanU || f.username || '', newClub).catch(() => {});
      }
    });

    return newClub;
  }

  /**
   * Submit an album nomination by this week's curator.
   * Locks in album, starts 7-day countdown, moves stage to 'listen'.
   */
  public static nominateAlbum(clubId: string, nomination: AlbumNomination): AlbumClub | null {
    const club = this.getClubById(clubId);
    if (!club) return null;

    const now = Date.now();
    const cycle = club.currentCycle;

    // Initialize progress map for all members
    const memberProgress: WeeklyCycle['memberProgress'] = {};
    club.members.forEach(m => {
      memberProgress[m.id] = {
        listenedTrackIds: [],
        hasSubmitted: false
      };
    });

    const updatedCycle: WeeklyCycle = {
      ...cycle,
      stage: 'listen',
      cycleStartTimestamp: now,
      cycleEndTimestamp: now + SEVEN_DAYS_MS,
      nomination,
      memberProgress,
      secretReviews: {},
      verdict: null
    };

    const updatedClub: AlbumClub = {
      ...club,
      currentCycle: updatedCycle
    };

    this.saveClub(updatedClub);
    return updatedClub;
  }

  /**
   * Hybrid listen tracking:
   * Toggle a track's listened state manually or via auto-telemetry.
   */
  public static toggleTrackListened(
    clubId: string, 
    memberId: string, 
    trackId: string, 
    explicitState?: boolean
  ): AlbumClub | null {
    const club = this.getClubById(clubId);
    if (!club || !club.currentCycle || !club.currentCycle.nomination) return null;

    const cycle = club.currentCycle;
    const progress = cycle.memberProgress[memberId] || { listenedTrackIds: [], hasSubmitted: false };
    const set = new Set(progress.listenedTrackIds || []);

    const shouldListen = explicitState !== undefined ? explicitState : !set.has(trackId);
    if (shouldListen) {
      set.add(trackId);
    } else {
      set.delete(trackId);
    }

    const totalTracks = cycle.nomination?.tracks?.length || 1;
    const allDone = set.size >= totalTracks;

    const updatedClub: AlbumClub = {
      ...club,
      members: club.members.map(m => m.id === memberId ? { ...m, hasListened: allDone } : m),
      currentCycle: {
        ...cycle,
        memberProgress: {
          ...cycle.memberProgress,
          [memberId]: {
            ...progress,
            listenedTrackIds: Array.from(set)
          }
        }
      }
    };

    this.saveClub(updatedClub);
    return updatedClub;
  }

  /**
   * Audio Engine Telemetry: called when a track has played for >= 45 seconds
   */
  public static recordPlaybackProgress(
    clubId: string, 
    memberId: string, 
    trackId: string, 
    secondsListened: number
  ): boolean {
    if (secondsListened < 45) return false;
    const club = this.getClubById(clubId);
    if (!club || !club.currentCycle || !club.currentCycle.nomination) return false;

    const isAlbumTrack = club.currentCycle.nomination.tracks.some(t => t.id === trackId || t.title.toLowerCase() === trackId.toLowerCase());
    if (!isAlbumTrack) return false;

    this.toggleTrackListened(clubId, memberId, trackId, true);
    return true;
  }

  /**
   * Submit Secret Review
   * Kept private until strict 7-day timer finishes
   */
  public static submitReview(clubId: string, review: MemberReview): AlbumClub | null {
    const club = this.getClubById(clubId);
    if (!club || !club.currentCycle) return null;

    const cycle = club.currentCycle;
    const progress = cycle.memberProgress[review.memberId] || { listenedTrackIds: [], hasSubmitted: false };

    const updatedCycle: WeeklyCycle = {
      ...cycle,
      secretReviews: {
        ...cycle.secretReviews,
        [review.memberId]: review
      },
      memberProgress: {
        ...cycle.memberProgress,
        [review.memberId]: {
          ...progress,
          hasSubmitted: true
        }
      }
    };

    const updatedClub: AlbumClub = {
      ...club,
      members: club.members.map(m => m.id === review.memberId ? { ...m, hasSubmitted: true } : m),
      currentCycle: updatedCycle
    };

    this.saveClub(updatedClub);
    return updatedClub;
  }

  /**
   * Save an individual track rating in the user's secret review.
   * Persists immediately so ratings are never lost when switching songs.
   */
  public static saveTrackRating(
    clubId: string, 
    memberId: string, 
    username: string, 
    trackId: string, 
    score: number
  ): AlbumClub | null {
    const club = this.getClubById(clubId);
    if (!club || !club.currentCycle) return null;

    const cycle = club.currentCycle;
    const existingReview: MemberReview = cycle.secretReviews[memberId] || {
      memberId,
      username,
      albumRating: 8.5,
      favoriteTrackId: trackId,
      favoriteTrackTitle: '',
      trackRatings: {},
      reviewText: '',
      submittedAt: Date.now()
    };

    const nextTrackRatings = {
      ...(existingReview.trackRatings || {}),
      [trackId]: Math.max(1.0, Math.min(10.0, Math.round(score * 10) / 10))
    };

    const vals = Object.values(nextTrackRatings);
    const avgScore = vals.length > 0 
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 
      : existingReview.albumRating;

    const updatedReview: MemberReview = {
      ...existingReview,
      albumRating: existingReview.albumRating || avgScore,
      trackRatings: nextTrackRatings,
      submittedAt: Date.now()
    };

    const updatedCycle: WeeklyCycle = {
      ...cycle,
      secretReviews: {
        ...cycle.secretReviews,
        [memberId]: updatedReview
      }
    };

    const updatedClub: AlbumClub = {
      ...club,
      currentCycle: updatedCycle
    };

    this.saveClub(updatedClub);

    try {
      SupabaseService.submitTrackRating({
        club_id: clubId,
        user_id: memberId,
        username,
        track_id: trackId,
        score
      }).catch(() => {});
    } catch (_) {}

    return updatedClub;
  }

  /**
   * Remove a member from the club (e.g. when declining an invite)
   */
  public static removeMember(clubId: string, memberId: string): AlbumClub | null {
    const club = this.getClubById(clubId);
    if (!club) return null;

    const updatedMembers = (club.members || []).filter(m => m.id !== memberId);
    const updatedProgress = { ...(club.currentCycle?.memberProgress || {}) };
    delete updatedProgress[memberId];

    const updatedSecretReviews = { ...(club.currentCycle?.secretReviews || {}) };
    delete updatedSecretReviews[memberId];

    const updatedClub: AlbumClub = {
      ...club,
      members: updatedMembers,
      currentCycle: club.currentCycle ? {
        ...club.currentCycle,
        memberProgress: updatedProgress,
        secretReviews: updatedSecretReviews
      } : club.currentCycle
    };

    this.saveClub(updatedClub);
    return updatedClub;
  }

  /**
   * Force Early Reveal (Available to host if needed, or used for testing/demo)
   */
  public static triggerEarlyReveal(clubId: string): AlbumClub | null {
    const club = this.getClubById(clubId);
    if (!club || !club.currentCycle) return null;

    const verdict = this.calculateVerdict(club.currentCycle);
    const updatedClub: AlbumClub = {
      ...club,
      currentCycle: {
        ...club.currentCycle,
        stage: 'reveal',
        verdict
      }
    };

    this.saveClub(updatedClub);
    this.enrichVerdictWithAi(updatedClub);
    return updatedClub;
  }

  /**
   * Advance to Next Week (Moves current cycle to archive, rotates curator)
   */
  public static advanceToNextWeek(clubId: string): AlbumClub | null {
    const club = this.getClubById(clubId);
    if (!club || !club.currentCycle) return null;

    const cycle = club.currentCycle;
    if (!cycle.nomination) return club;

    // Ensure verdict is computed
    const verdict = cycle.verdict || this.calculateVerdict(cycle);
    const archiveReviews = Object.values(cycle.secretReviews || {});

    // Save to Archive
    const newArchiveEntry = {
      weekNumber: cycle.weekNumber,
      nomination: cycle.nomination,
      verdict,
      reviews: archiveReviews,
      completedAt: Date.now()
    };

    // Rotate Curator
    const nextRotationIndex = (club.curatorRotationIndex + 1) % club.members.length;
    const nextCurator = club.members[nextRotationIndex];

    const updatedMembers = club.members.map((m, idx) => ({
      ...m,
      isCurator: idx === nextRotationIndex,
      hasListened: false,
      hasSubmitted: false
    }));

    const now = Date.now();
    const newCycle: WeeklyCycle = {
      weekNumber: cycle.weekNumber + 1,
      stage: 'nominate',
      curatorMemberId: nextCurator.id,
      curatorUsername: nextCurator.username,
      cycleStartTimestamp: now,
      cycleEndTimestamp: now + SEVEN_DAYS_MS,
      nomination: null,
      memberProgress: {},
      secretReviews: {},
      verdict: null
    };

    const updatedClub: AlbumClub = {
      ...club,
      curatorRotationIndex: nextRotationIndex,
      members: updatedMembers,
      currentCycle: newCycle,
      archive: [newArchiveEntry, ...(club.archive || [])]
    };

    this.saveClub(updatedClub);
    return updatedClub;
  }

  /**
   * Group Verdict Computation
   * Calculates average score (1.0-10.0), consensus favorite, highest rated track, and divisive track.
   */
  public static calculateVerdict(cycle: WeeklyCycle): ClubCycleVerdict {
    const reviews = Object.values(cycle.secretReviews || {});
    const totalSubmissions = reviews.length;

    if (totalSubmissions === 0) {
      return {
        averageRating: 0,
        totalSubmissions: 0,
        favoriteTrack: { trackId: '', title: 'None selected', voteCount: 0 },
        highestRatedTrack: { trackId: '', title: 'None rated', averageRating: 0 },
        mostDivisiveTrack: { trackId: '', title: 'None', variance: 0, highestScore: 0, lowestScore: 0 },
        aiSummary: 'No ratings submitted for this album cycle.'
      };
    }

    // 1. Average Album Score
    const totalScore = reviews.reduce((acc, r) => acc + (r.albumRating || 0), 0);
    const averageRating = Math.round((totalScore / totalSubmissions) * 10) / 10;

    // 2. Favorite Track Votes
    const favCount: Record<string, { title: string; count: number }> = {};
    reviews.forEach(r => {
      if (r.favoriteTrackTitle) {
        const key = r.favoriteTrackTitle.toLowerCase();
        favCount[key] = favCount[key] || { title: r.favoriteTrackTitle, count: 0 };
        favCount[key].count++;
      }
    });

    let topFav = { trackId: '', title: 'TBD', voteCount: 0 };
    Object.values(favCount).forEach(f => {
      if (f.count > topFav.voteCount) {
        topFav = { trackId: '', title: f.title, voteCount: f.count };
      }
    });

    // 3. Track-by-Track Ratings Aggregate
    const trackScores: Record<string, number[]> = {};
    reviews.forEach(r => {
      if (r.trackRatings) {
        Object.entries(r.trackRatings).forEach(([tId, score]) => {
          if (!trackScores[tId]) trackScores[tId] = [];
          trackScores[tId].push(score);
        });
      }
    });

    let bestTrack = { trackId: '', title: 'TBD', averageRating: 0 };
    let mostDivisive = { trackId: '', title: 'TBD', variance: 0, highestScore: 0, lowestScore: 0 };

    const tracks = cycle.nomination?.tracks || [];

    Object.entries(trackScores).forEach(([tId, scores]) => {
      if (scores.length === 0) return;
      const trackObj = tracks.find(t => t.id === tId);
      const title = trackObj ? trackObj.title : tId;

      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg > bestTrack.averageRating) {
        bestTrack = { trackId: tId, title, averageRating: Math.round(avg * 10) / 10 };
      }

      if (scores.length >= 2) {
        const mean = avg;
        const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
        const max = Math.max(...scores);
        const min = Math.min(...scores);
        if (variance > mostDivisive.variance) {
          mostDivisive = {
            trackId: tId,
            title,
            variance: Math.round(variance * 100) / 100,
            highestScore: max,
            lowestScore: min
          };
        }
      }
    });

    return {
      averageRating,
      totalSubmissions,
      favoriteTrack: topFav.voteCount > 0 ? topFav : { trackId: '', title: tracks[0]?.title || 'Various', voteCount: 1 },
      highestRatedTrack: bestTrack.averageRating > 0 ? bestTrack : { trackId: '', title: tracks[0]?.title || 'Various', averageRating: averageRating },
      mostDivisiveTrack: mostDivisive.variance > 0 ? mostDivisive : {
        trackId: tracks[tracks.length - 1]?.id || '',
        title: tracks[tracks.length - 1]?.title || 'Album Closer',
        variance: 0.8,
        highestScore: Math.min(10, averageRating + 1.5),
        lowestScore: Math.max(1, averageRating - 1.5)
      },
      aiSummary: 'Ratings revealed! Group consensus summary compiling...'
    };
  }

  /**
   * Generates AI Group Consensus Summary via Gemini
   */
  private static async enrichVerdictWithAi(club: AlbumClub): Promise<void> {
    try {
      const cycle = club.currentCycle;
      if (!cycle || !cycle.verdict || !cycle.nomination) return;

      const albumTitle = cycle.nomination.title;
      const artist = cycle.nomination.artist;
      const reviews = Object.values(cycle.secretReviews || []);

      const notes = reviews.map(r => `@${r.username} (${r.albumRating}/10): "${r.reviewText || 'No comment'}" - fav: ${r.favoriteTrackTitle}`).join('\n');

      const prompt = `Synthesize a lively, 2-3 sentence music club consensus verdict for the album "${albumTitle}" by ${artist}.
The group gave it an average rating of ${cycle.verdict.averageRating}/10.
Consensus favorite track: ${cycle.verdict.favoriteTrack.title}.
Highest rated track: ${cycle.verdict.highestRatedTrack.title}.
Most polarizing track: ${cycle.verdict.mostDivisiveTrack.title}.
Member reviews:
${notes}

Keep it warm, conversational, and direct (max 45 words). No markdown or bullet points.`;

      let summary = '';
      if (GeminiService.hasApiKey()) {
        const apiKey = GeminiService.getApiKey();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 80 }
          })
        });
        if (res.ok) {
          const data = await res.json();
          summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }
      }

      if (!summary) {
        summary = `The club scored ${albumTitle} a solid ${cycle.verdict.averageRating}★. "${cycle.verdict.favoriteTrack.title}" stood out as the group anthem, with energetic debates over ${cycle.verdict.mostDivisiveTrack.title}.`;
      }

      if (club.currentCycle?.verdict) {
        club.currentCycle.verdict.aiSummary = summary;
      }
      this.saveClub(club);
    } catch (_) {}
  }
}
