/**
 * LUMEN CIRCLE RADIO SERVICE
 * Collaborative shared discovery room for 2–8 friends.
 * Balances taste signals across participants, generates candidate batches
 * with clear reasoning ("Why this was picked"), and learns in real-time from group feedback.
 */

import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { FirestoreService } from './firestoreService';
import { SupabaseService } from './supabaseService';
import { LikedService } from './likedService';
import { PlaylistService } from './playlistService';
import { StreamingService } from './streamingService';
import { AppUser } from './firebaseAuthService';
import { Track } from '../types/music';
import { 
  CircleRadioSession, 
  CircleRadioParticipant, 
  CircleRadioCandidate, 
  CircleDiscoveryMode, 
  CircleFeedbackType,
  CircleTasteSeed
} from '../types/circleRadioTypes';

export class CircleRadioService {
  private static STORAGE_KEY = 'lumen_circle_radio_sessions';
  private static ACTIVE_KEY = 'lumen_active_circle_radio';

  /**
   * Get cached sessions locally
   */
  public static getLocalSessions(): CircleRadioSession[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  private static saveLocalSessions(sessions: CircleRadioSession[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sessions));
    } catch (_) {}
  }

  /**
   * Create a new Circle Radio Session
   */
  public static async createSession(
    hostUser: AppUser,
    title: string,
    mode: CircleDiscoveryMode = 'common_ground',
    invitedFriends: Array<{ uid: string; username: string; displayName: string; photoURL?: string | null }> = [],
    friendProfiles: Array<{ userId: string; username: string; sharedArtists?: string[]; currentTrack?: Track | null }> = []
  ): Promise<{ success: boolean; session?: CircleRadioSession; error?: string }> {
    const sessionId = `circle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const hostParticipant: CircleRadioParticipant = {
      userId: hostUser.uid,
      username: hostUser.username || hostUser.displayName || 'host',
      displayName: hostUser.displayName || hostUser.username || 'Host',
      photoURL: hostUser.photoURL || null,
      isHost: true,
      preferenceContributionEnabled: true,
      joinedAt: now
    };

    const friendParticipants: CircleRadioParticipant[] = invitedFriends.map(f => ({
      userId: f.uid,
      username: f.username,
      displayName: f.displayName,
      photoURL: f.photoURL || null,
      isHost: false,
      preferenceContributionEnabled: true,
      joinedAt: now
    }));

    const participants = [hostParticipant, ...friendParticipants];

    // Extract dynamic seeds from friends' listening habits & top artists
    const seeds = this.extractTasteSeeds(participants, friendProfiles);

    // Generate initial candidate batch (8-10 tracks) using harvested seeds
    const initialCandidates = await this.generateCandidateBatch(
      sessionId,
      mode,
      participants,
      1,
      seeds
    );

    const session: CircleRadioSession = {
      id: sessionId,
      hostUserId: hostUser.uid,
      hostUsername: hostUser.username || 'host',
      hostDisplayName: hostUser.displayName || 'Host',
      title: title.trim() || 'Circle Radio Jam',
      status: 'active',
      discoveryMode: mode,
      participants,
      candidates: initialCandidates,
      seeds,
      currentCandidateId: initialCandidates[0]?.id || null,
      batchCount: 1,
      createdAt: now,
      updatedAt: now
    };

    // Save locally
    const sessions = this.getLocalSessions();
    this.saveLocalSessions([session, ...sessions.filter(s => s.id !== sessionId)]);
    try {
      localStorage.setItem(`${this.ACTIVE_KEY}_${sessionId}`, JSON.stringify(session));
    } catch (_) {}

    // Broadcast to Firestore & notify invited friends asynchronously in background (zero UI blocking)
    this.syncToCloud(session).catch(() => {});
    if (invitedFriends.length > 0) {
      this.sendSessionInvites(session, hostUser, invitedFriends).catch(() => {});
    }

    return { success: true, session };
  }

  /**
   * Upsert a Circle Radio session locally (used when accepting an invite or receiving live updates)
   */
  public static upsertLocalSession(session: CircleRadioSession): void {
    if (!session || !session.id) return;
    const all = this.getLocalSessions();
    this.saveLocalSessions([session, ...all.filter(s => s.id !== session.id)]);
    try {
      localStorage.setItem(`${this.ACTIVE_KEY}_${session.id}`, JSON.stringify(session));
    } catch (_) {}
  }

  /**
   * Send ONE unified invite per invited friend via BOTH Supabase Realtime & Firestore shares
   */
  private static async sendSessionInvites(
    session: CircleRadioSession,
    hostUser: AppUser,
    invitedFriends: Array<{ uid: string; username: string; displayName: string; photoURL?: string | null }>
  ): Promise<void> {
    const db = (FirestoreService as any).getDb?.();
    const now = Date.now();
    await Promise.allSettled(
      invitedFriends
        .filter(f => f.uid && f.uid !== hostUser.uid)
        .map(async (f) => {
          const cleanU = (f.username || '').replace(/^@/, '').trim().toLowerCase();
          const shareId = `share_circle_${session.id}_${f.uid || cleanU}`;
          const message = `Invited you to Circle Radio "${session.title}"`;

          // 1. Instant Supabase push
          SupabaseService.sendSongShare({
            id: shareId,
            sender_id: hostUser.uid,
            sender_username: hostUser.username || hostUser.displayName || 'Friend',
            sender_display_name: hostUser.displayName || hostUser.username || 'Friend',
            recipient_id: f.uid,
            recipient_username: cleanU || f.username,
            type: 'circle_radio_invite',
            session_id: session.id,
            session_title: session.title,
            sessionId: session.id,
            sessionTitle: session.title,
            session,
            message
          } as any).catch(() => {});

          // 2. Persistent Firestore share doc
          if (db) {
            const shareRef = doc(db, 'shares', shareId);
            await setDoc(shareRef, {
              id: shareId,
              type: 'circle_radio_invite',
              sessionId: session.id,
              sessionTitle: session.title,
              session,
              senderId: hostUser.uid,
              senderUsername: hostUser.username || hostUser.displayName || 'Friend',
              senderDisplayName: hostUser.displayName || hostUser.username || 'Friend',
              recipientId: f.uid,
              recipientUsername: cleanU || f.username,
              message,
              read: false,
              createdAt: now
            }, { merge: true });
          }
        })
    );
  }

  /**
   * Sync Circle Radio Session to Supabase Realtime (<30ms) & Firestore
   */
  public static async syncToCloud(session: CircleRadioSession): Promise<void> {
    try {
      SupabaseService.broadcastToChannel(`circle:${session.id}`, 'circle:update', session).catch(() => {});
    } catch (_) {}

    try {
      const db = (FirestoreService as any).getDb?.();
      if (!db) return;
      const roomRef = doc(db, 'shares', `circle_room_${session.id}`);
      await setDoc(roomRef, {
        id: `circle_room_${session.id}`,
        type: 'circle_room',
        sessionId: session.id,
        session,
        updatedAt: session.updatedAt
      }, { merge: true });
    } catch (err) {
      console.warn('[CircleRadioService] Cloud sync notice:', err);
    }
  }

  /**
   * Subscribe to real-time updates for a Circle Radio session (Supabase Realtime + Firestore)
   */
  public static subscribeToSession(
    sessionId: string,
    callback: (session: CircleRadioSession | null) => void
  ): () => void {
    let highestUpdatedAt = 0;
    const emitIfNewer = (liveSession: CircleRadioSession | null) => {
      if (!liveSession || liveSession.id !== sessionId) return;
      const upd = Number(liveSession.updatedAt || 0);
      if (upd < highestUpdatedAt) return;
      highestUpdatedAt = upd;
      this.upsertLocalSession(liveSession);
      callback(liveSession);
    };

    try {
      const cached = localStorage.getItem(`${this.ACTIVE_KEY}_${sessionId}`);
      if (cached) emitIfNewer(JSON.parse(cached));
    } catch (_) {}

    // 1. Supabase Realtime listener
    try {
      const ch = (SupabaseService as any).getOrCreateChannel?.(`circle:${sessionId}`);
      if (ch) {
        ch.on('broadcast', { event: 'circle:update' }, ({ payload }: any) => {
          if (payload?.id === sessionId) emitIfNewer(payload);
        });
      }
    } catch (_) {}

    // 2. Firestore snapshot listener
    try {
      const db = (FirestoreService as any).getDb?.();
      if (!db) return () => {};

      const roomRef = doc(db, 'shares', `circle_room_${sessionId}`);
      const unsub = onSnapshot(roomRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const liveSession: CircleRadioSession = data.session || data;
          emitIfNewer(liveSession);
        }
      }, (err) => {
        console.warn('[CircleRadioService] Snapshot listener notice:', err);
      });

      return unsub;
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Harvest real taste seeds from friends' actual listening stats, shared artists, and library
   */
  public static extractTasteSeeds(
    participants: CircleRadioParticipant[],
    friendProfiles: Array<{ userId: string; username: string; sharedArtists?: string[]; currentTrack?: Track | null }> = []
  ): CircleTasteSeed[] {
    const seeds: CircleTasteSeed[] = [];
    const seenLabels = new Set<string>();

    const addSeed = (label: string, type: 'artist' | 'track' | 'genre' | 'custom', username: string, userId: string, sourceType: any) => {
      const clean = label.trim();
      if (!clean || seenLabels.has(clean.toLowerCase())) return;
      seenLabels.add(clean.toLowerCase());
      seeds.push({
        id: `seed_${userId}_${Math.random().toString(36).slice(2, 7)}`,
        label: clean,
        type,
        sourceUsername: username,
        sourceUserId: userId,
        sourceType,
        enabled: true
      });
    };

    // 1. Harvest from active participating friends
    participants.forEach(p => {
      const friend = friendProfiles.find(f => f.userId === p.userId || f.username.toLowerCase() === p.username.toLowerCase());
      if (friend) {
        if (friend.sharedArtists && friend.sharedArtists.length > 0) {
          friend.sharedArtists.forEach(art => {
            addSeed(art, 'artist', p.username, p.userId, 'most_played_artist');
          });
        }
        if (friend.currentTrack?.artist) {
          addSeed(friend.currentTrack.artist, 'artist', p.username, p.userId, 'liked_artist');
        }
        if (friend.currentTrack?.title) {
          addSeed(friend.currentTrack.title, 'track', p.username, p.userId, 'most_played_song');
        }
      }
    });

    // 2. Harvest from current user's library and liked tracks
    const userLikes = LikedService.getLikedTracks();
    const userPlaylists = PlaylistService.getPlaylists();
    const allTracks = [...userLikes, ...userPlaylists.flatMap(pl => pl.tracks || [])];

    // Top user artists
    const artistCounts = new Map<string, number>();
    allTracks.forEach(t => {
      if (t.artist) {
        artistCounts.set(t.artist, (artistCounts.get(t.artist) || 0) + 1);
      }
    });

    const sortedArtists = Array.from(artistCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);

    sortedArtists.slice(0, 6).forEach(art => {
      addSeed(art, 'artist', 'You', 'me', 'most_played_artist');
    });

    // Top user tracks
    allTracks.slice(0, 4).forEach(t => {
      if (t.title) {
        addSeed(t.title, 'track', 'You', 'me', 'most_played_song');
      }
    });

    // Fallback evergreen seeds if user has zero listening history
    if (seeds.length === 0) {
      ['Daft Punk', 'Gorillaz', 'Tame Impala', 'The Weeknd', 'Radiohead', 'Billie Eilish'].forEach(art => {
        addSeed(art, 'artist', 'Group Discovery', 'fallback', 'custom');
      });
    }

    return seeds;
  }

  /**
   * Update session seeds (for editable feed)
   */
  public static async updateSessionSeeds(
    sessionId: string,
    seeds: CircleTasteSeed[]
  ): Promise<{ success: boolean; session?: CircleRadioSession }> {
    const session = this.getLocalSessions().find(s => s.id === sessionId);
    if (!session) return { success: false };

    const updatedSession: CircleRadioSession = {
      ...session,
      seeds,
      updatedAt: Date.now()
    };

    const sessions = this.getLocalSessions();
    this.saveLocalSessions(sessions.map(s => s.id === sessionId ? updatedSession : s));

    try {
      localStorage.setItem(`${this.ACTIVE_KEY}_${sessionId}`, JSON.stringify(updatedSession));
    } catch (_) {}

    await this.syncToCloud(updatedSession);
    return { success: true, session: updatedSession };
  }

  /**
   * Regenerate candidate batch using active seeds
   */
  public static async regenerateFromSeeds(
    session: CircleRadioSession
  ): Promise<{ success: boolean; session?: CircleRadioSession }> {
    const activeSeeds = (session.seeds || []).filter(s => s.enabled);
    const freshBatch = await this.generateCandidateBatch(
      session.id,
      session.discoveryMode,
      session.participants,
      session.batchCount + 1,
      activeSeeds
    );

    const updatedSession: CircleRadioSession = {
      ...session,
      candidates: freshBatch,
      currentCandidateId: freshBatch[0]?.id || null,
      batchCount: session.batchCount + 1,
      updatedAt: Date.now()
    };

    const sessions = this.getLocalSessions();
    this.saveLocalSessions(sessions.map(s => s.id === session.id ? updatedSession : s));

    try {
      localStorage.setItem(`${this.ACTIVE_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    await this.syncToCloud(updatedSession);
    return { success: true, session: updatedSession };
  }

  /**
   * Generate a candidate batch based on discovery mode and participant tastes
   */
  public static async generateCandidateBatch(
    sessionId: string,
    mode: CircleDiscoveryMode,
    participants: CircleRadioParticipant[],
    batchNumber: number,
    customSeeds?: CircleTasteSeed[]
  ): Promise<CircleRadioCandidate[]> {
    const candidates: CircleRadioCandidate[] = [];
    const now = Date.now();
    const batchId = `b_${batchNumber}_${now}`;

    // Active participants with preference contribution enabled
    const activeContributors = participants.filter(p => p.preferenceContributionEnabled);
    const contributorUsernames = activeContributors.map(p => p.username);

    // 1. Gather real taste seeds from local user library & liked tracks
    const userLikes = LikedService.getLikedTracks();
    const userPlaylists = PlaylistService.getPlaylists();
    const playlistTracks = userPlaylists.flatMap(p => p.tracks || []);
    const seedPool: Track[] = [...userLikes, ...playlistTracks];

    // Seed query terms
    const activeCustomSeeds = (customSeeds || []).filter(s => s.enabled);
    const customLabels = activeCustomSeeds.map(s => s.label);

    const seedArtists = Array.from(new Set(seedPool.map(t => t.artist).filter(Boolean)));
    const defaultSearchTerms = ['Daft Punk', 'Gorillaz', 'Tame Impala', 'The Weeknd', 'Kendrick Lamar', 'Radiohead', 'Billie Eilish'];

    const searchSeeds = customLabels.length > 0
      ? customLabels
      : (seedArtists.length >= 3 ? seedArtists.slice(0, 8) : defaultSearchTerms);

    try {
      // Pick query based on mode
      let queryTerm = searchSeeds[Math.floor(Math.random() * searchSeeds.length)];
      if (mode === 'discovery_blend' && customLabels.length === 0) {
        const blendTerms = ['Indie Electronic', 'Neo Soul', 'Atmospheric Synth', 'Chillwave', 'Nu Disco'];
        queryTerm = blendTerms[Math.floor(Math.random() * blendTerms.length)];
      }

      let fetchedTracks: Track[] = [];
      try {
        const timeoutPromise = new Promise<Track[]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500));
        fetchedTracks = await Promise.race([StreamingService.searchTracks(queryTerm), timeoutPromise]);
      } catch (_) {}

      // Resilient fallback: If streaming search was empty or timed out, seed from user likes/library tracks
      if (!fetchedTracks || fetchedTracks.length === 0) {
        fetchedTracks = seedPool.length > 0 ? seedPool.slice(0, 10) : [];
      }

      const filtered = fetchedTracks.slice(0, 10);

      filtered.forEach((track, idx) => {
        let explanation = '';
        const matchingSeed = activeCustomSeeds.find(s => 
          (track.artist && s.label.toLowerCase().includes(track.artist.toLowerCase())) ||
          (track.title && s.label.toLowerCase().includes(track.title.toLowerCase()))
        ) || (activeCustomSeeds.length > 0 ? activeCustomSeeds[idx % activeCustomSeeds.length] : undefined);

        if (matchingSeed) {
          if (matchingSeed.sourceType === 'most_played_artist') {
            explanation = `Inspired by @${matchingSeed.sourceUsername}'s top artist: ${matchingSeed.label}`;
          } else if (matchingSeed.sourceType === 'most_played_song') {
            explanation = `Echoes @${matchingSeed.sourceUsername}'s favorite song: ${matchingSeed.label}`;
          } else {
            explanation = `Matched to @${matchingSeed.sourceUsername}'s taste profile: ${matchingSeed.label}`;
          }
        } else if (mode === 'common_ground') {
          explanation = `Overlap in ${track.artist || 'genre'} preferences across ${contributorUsernames.length > 1 ? `@${contributorUsernames[0]} & friends` : 'the group'}`;
        } else if (mode === 'equal_rotation') {
          const rotationUser = contributorUsernames[idx % contributorUsernames.length] || 'circle';
          explanation = `Curated for @${rotationUser}'s musical wavelength`;
        } else {
          explanation = `Fresh discovery matching group sound profile`;
        }

        candidates.push({
          id: `cand_${sessionId}_${batchNumber}_${idx}_${track.id}`,
          sessionId,
          track: {
            ...track,
            provider: (track as any).provider || 'saavn',
            providerTrackId: (track as any).providerTrackId || track.id
          } as any as Track,
          rankScore: Math.round(92 - idx * 3.5),
          explanation,
          sourceUsernames: contributorUsernames.slice(0, 2),
          status: 'queued',
          feedback: {},
          batchId,
          generatedAt: now
        });
      });
    } catch (_) {
      // Fallback seeds if search is offline
      seedPool.slice(0, 8).forEach((track, idx) => {
        candidates.push({
          id: `cand_${sessionId}_${batchNumber}_${idx}_${track.id}`,
          sessionId,
          track,
          rankScore: 88,
          explanation: `Saved favorite from group collection`,
          sourceUsernames: contributorUsernames.slice(0, 2),
          status: 'queued',
          feedback: {},
          batchId,
          generatedAt: now
        });
      });
    }

    return candidates;
  }

  /**
   * Submit participant feedback on a candidate track
   */
  public static async submitFeedback(
    session: CircleRadioSession,
    candidateId: string,
    user: AppUser,
    type: CircleFeedbackType
  ): Promise<{ success: boolean; session?: CircleRadioSession }> {
    const candidate = session.candidates.find(c => c.id === candidateId);
    if (!candidate) return { success: false };

    const feedback = { ...candidate.feedback, [user.uid]: type };
    let status = candidate.status;
    let rankScore = candidate.rankScore;

    if (type === 'like') {
      rankScore += 5;
    } else if (type === 'not_for_me') {
      rankScore -= 15;
    }

    const now = Date.now();
    const updatedCandidates = session.candidates.map(c => {
      if (c.id === candidateId) {
        return { ...c, feedback, status, rankScore };
      }
      return c;
    });

    const updatedSession: CircleRadioSession = {
      ...session,
      candidates: updatedCandidates,
      updatedAt: now
    };

    try {
      localStorage.setItem(`${this.ACTIVE_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    await this.syncToCloud(updatedSession);
    return { success: true, session: updatedSession };
  }

  /**
   * Advance to next candidate or replenish batch
   */
  public static async nextCandidate(
    session: CircleRadioSession
  ): Promise<{ success: boolean; session?: CircleRadioSession }> {
    const currentIndex = session.candidates.findIndex(c => c.id === session.currentCandidateId);
    let nextIndex = currentIndex + 1;
    let candidates = [...session.candidates];
    let batchCount = session.batchCount;

    // If approaching end of batch (fewer than 3 upcoming candidates), replenish!
    if (nextIndex >= candidates.length - 2) {
      batchCount += 1;
      const freshBatch = await this.generateCandidateBatch(
        session.id,
        session.discoveryMode,
        session.participants,
        batchCount
      );
      candidates = [...candidates, ...freshBatch];
    }

    const nextCandidate = candidates[nextIndex] || candidates[0];
    const now = Date.now();

    const updatedSession: CircleRadioSession = {
      ...session,
      candidates,
      currentCandidateId: nextCandidate ? nextCandidate.id : null,
      batchCount,
      updatedAt: now
    };

    try {
      localStorage.setItem(`${this.ACTIVE_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    await this.syncToCloud(updatedSession);
    return { success: true, session: updatedSession };
  }

  /**
   * Toggle participant preference contribution
   */
  public static async toggleParticipantContribution(
    session: CircleRadioSession,
    userId: string
  ): Promise<{ success: boolean; session?: CircleRadioSession }> {
    const updatedParticipants = session.participants.map(p => {
      if (p.userId === userId) {
        return {
          ...p,
          preferenceContributionEnabled: !p.preferenceContributionEnabled
        };
      }
      return p;
    });

    const now = Date.now();
    const updatedSession: CircleRadioSession = {
      ...session,
      participants: updatedParticipants,
      updatedAt: now
    };

    try {
      localStorage.setItem(`${this.ACTIVE_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    await this.syncToCloud(updatedSession);
    return { success: true, session: updatedSession };
  }
}
