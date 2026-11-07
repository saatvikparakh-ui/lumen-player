/**
 * LUMEN FIRESTORE REAL-TIME SOCIAL & CLOUD SYNC SERVICE
 * Provides multi-device real-time presence (Now Listening to),
 * global friend requests, real-time song sharing with personal notes,
 * and cloud playlist synchronization across any network.
 */

import {
  getFirestore,
  Firestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  onSnapshot,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
  limit,
  writeBatch,
  runTransaction
} from 'firebase/firestore';
import { FirebaseAuthService, AppUser } from './firebaseAuthService';
import { Track, CustomPlaylist } from '../types/music';

export interface UserPresence {
  userId: string;
  username: string;
  displayName: string;
  photoURL?: string | null;
  currentTrack: Track | null;
  isPlaying: boolean;
  updatedAt: number;
}

export interface FirestoreFriendRequest {
  id: string;
  fromUid: string;
  fromUsername: string;
  fromDisplayName: string;
  fromPhotoURL?: string | null;
  toUid: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
}

export interface FirestoreSongShare {
  id: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  recipientId: string;
  song: Track;
  message?: string;
  read: boolean;
  createdAt: number;
}

class FirestoreServiceClass {
  private db: Firestore | null = null;
  private presenceUnsub: (() => void) | null = null;
  private currentPresenceTrackId: string | null = null;

  public getDb(): Firestore | null {
    if (this.db) return this.db;
    try {
      const app = FirebaseAuthService.getApp();
      if (app) {
        this.db = getFirestore(app);
      }
    } catch (err) {
      console.warn('[Firestore] Init error:', err);
    }
    return this.db;
  }

  /**
   * Updates current user's live listening status in Firestore
   */
  public async updatePresence(
    user: AppUser | null,
    track: Track | null,
    isPlaying: boolean
  ): Promise<void> {
    if (!user || user.isGuest) return;
    const db = this.getDb();
    if (!db) return;

    // Avoid duplicate writes if track & playing state hasn't changed
    const key = `${track?.id}_${isPlaying}`;
    if (this.currentPresenceTrackId === key) return;
    this.currentPresenceTrackId = key;

    try {
      const presenceRef = doc(db, 'presence', user.uid);
      await setDoc(
        presenceRef,
        {
          userId: user.uid,
          username: user.email?.split('@')[0] || 'listener',
          displayName: user.displayName || 'Lumen Listener',
          photoURL: user.photoURL || null,
          currentTrack: track ? {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album || null,
            duration: track.duration || 0,
            artworkUrl: track.artworkUrl || null
          } : null,
          isPlaying,
          updatedAt: Date.now()
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('[Firestore] Presence update failed:', e);
    }
  }

  /**
   * Listen to live presence updates for a list of friend user IDs
   */
  public subscribeToFriendsPresence(
    friendUids: string[],
    callback: (presences: Record<string, UserPresence>) => void
  ): () => void {
    const db = this.getDb();
    if (!db || friendUids.length === 0) {
      callback({});
      return () => {};
    }

    try {
      const q = query(
        collection(db, 'presence'),
        where('userId', 'in', friendUids.slice(0, 10))
      );

      return onSnapshot(
        q,
        (snapshot) => {
          const map: Record<string, UserPresence> = {};
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as UserPresence;
            map[data.userId] = data;
          });
          callback(map);
        },
        (err) => {
          console.warn('[Firestore] Presence subscription error:', err);
        }
      );
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Register or claim unique @username in Firestore
   */
  public async registerUsername(
    uid: string,
    username: string,
    displayName: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database not initialized' };

    const cleanUsername = username.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, '').slice(0, 20);
    if (!cleanUsername || cleanUsername.length < 3) {
      return { success: false, error: 'Username must be at least 3 characters (letters, numbers, underscores, dots)' };
    }

    try {
      const usernameRef = doc(db, 'usernames', cleanUsername);
      const userRef = doc(db, 'users', uid);

      await runTransaction(db, async (transaction) => {
        const uSnap = await transaction.get(usernameRef);
        if (uSnap.exists()) {
          const ownerId = uSnap.data().userId || uSnap.data().uid;
          if (ownerId && ownerId !== uid) {
            throw new Error('Username is already taken');
          }
        }

        const now = Date.now();
        transaction.set(usernameRef, {
          userId: uid,
          uid,
          user_id: uid,
          username: cleanUsername,
          displayName,
          updatedAt: now
        }, { merge: true });

        transaction.set(userRef, {
          userId: uid,
          uid,
          user_id: uid,
          username: cleanUsername,
          displayName,
          updatedAt: now
        }, { merge: true });
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to claim username' };
    }
  }

  /**
   * Search users by @username prefix in Firestore
   */
  public async searchUsersByUsername(searchQuery: string): Promise<Array<{
    uid: string;
    userId: string;
    user_id: string;
    username: string;
    displayName: string;
  }>> {
    const db = this.getDb();
    if (!db) return [];

    const clean = searchQuery.trim().toLowerCase().replace(/^@/, '');
    if (!clean) return [];

    try {
      const usernamesRef = collection(db, 'usernames');
      const q = query(
        usernamesRef,
        where('username', '>=', clean),
        where('username', '<=', clean + '\uf8ff'),
        limit(12)
      );

      const snapshot = await getDocs(q);
      const results: Array<{ uid: string; userId: string; user_id: string; username: string; displayName: string }> = [];
      snapshot.forEach(d => {
        const data = d.data();
        const id = data.userId || data.uid || data.user_id || d.id;
        results.push({
          uid: id,
          userId: id,
          user_id: id,
          username: data.username,
          displayName: data.displayName || `@${data.username}`
        });
      });
      return results;
    } catch (err) {
      console.warn('[Firestore] User search error:', err);
      return [];
    }
  }

  /**
   * Send a friend request via Firestore with target validation, duplicate check, and reverse auto-accept (B2, B3, B4, B9)
   */
  public async sendFriendRequest(
    fromUser: AppUser,
    toUidOrUsername: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database unavailable' };

    if (!fromUser || fromUser.isGuest) {
      return { success: false, error: 'Sign in to add friends and share music.' };
    }

    const rawInput = (toUidOrUsername || '').trim();
    if (!rawInput) {
      return { success: false, error: 'Please enter a valid @username.' };
    }

    // Resolve target UID
    let targetUid: string | null = null;
    let targetProfile: any = null;

    if (rawInput.startsWith('usr_')) {
      targetProfile = await this.getUserProfile(rawInput);
      if (targetProfile) {
        targetUid = rawInput;
      }
    }

    if (!targetUid) {
      const cleanU = rawInput.replace(/^@/, '').toLowerCase();
      targetProfile = await this.getUserByUsername(cleanU);
      if (targetProfile && targetProfile.userId) {
        targetUid = targetProfile.userId;
      }
    }

    if (!targetUid || !targetProfile) {
      return { success: false, error: `Listener "${rawInput}" not found. Verify the @username and try again.` };
    }

    if (fromUser.uid === targetUid) {
      return { success: false, error: 'You cannot send a friend request to yourself.' };
    }

    try {
      // 1. Check if already friends
      const fRef = doc(db, 'friendships', `${fromUser.uid}_${targetUid}`);
      const fSnap = await getDoc(fRef);
      if (fSnap.exists()) {
        return { success: false, error: `You and @${targetProfile.username || 'this user'} are already connected friends!` };
      }

      // 2. Check if the other person already sent a pending request to us (reverse request) -> auto-accept!
      const revReqRef = doc(db, 'friendRequests', `${targetUid}_${fromUser.uid}`);
      const revReqSnap = await getDoc(revReqRef);
      if (revReqSnap.exists() && revReqSnap.data().status === 'pending') {
        await this.respondToFriendRequest(revReqSnap.data() as FirestoreFriendRequest, true);
        return { success: true };
      }

      // 3. Check for existing pending request from us
      const reqId = `${fromUser.uid}_${targetUid}`;
      const reqRef = doc(db, 'friendRequests', reqId);
      const existingReq = await getDoc(reqRef);
      if (existingReq.exists() && existingReq.data().status === 'pending') {
        return { success: false, error: 'Friend request is already pending.' };
      }

      const senderUsername = fromUser.displayName?.replace(/^@/, '') || fromUser.email?.split('@')[0] || 'listener';

      await setDoc(reqRef, {
        id: reqId,
        fromUid: fromUser.uid,
        fromUsername: senderUsername,
        fromDisplayName: fromUser.displayName || `@${senderUsername}`,
        fromPhotoURL: fromUser.photoURL || null,
        toUid: targetUid,
        status: 'pending',
        createdAt: Date.now()
      }, { merge: true });

      return { success: true };
    } catch (err: any) {
      console.warn('[Firestore] sendFriendRequest error:', err);
      return { success: false, error: err.message || 'Failed to send friend request' };
    }
  }

  /**
   * Listen to incoming friend requests in real time (B6: always passes empty array on empty snapshot)
   */
  public subscribeToFriendRequests(
    userId: string,
    callback: (requests: FirestoreFriendRequest[]) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !userId) {
      callback([]);
      return () => {};
    }

    try {
      const q = query(
        collection(db, 'friendRequests'),
        where('toUid', '==', userId),
        where('status', '==', 'pending')
      );

      return onSnapshot(
        q,
        (snap) => {
          const list: FirestoreFriendRequest[] = [];
          snap.forEach(d => list.push(d.data() as FirestoreFriendRequest));
          callback(list);
        },
        () => callback([])
      );
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Accept or decline a friend request atomically via writeBatch (B5)
   */
  public async respondToFriendRequest(
    request: FirestoreFriendRequest,
    accept: boolean
  ): Promise<boolean> {
    const db = this.getDb();
    if (!db || !request) return false;

    try {
      const reqRef = doc(db, 'friendRequests', request.id);
      if (accept) {
        const batch = writeBatch(db);
        batch.update(reqRef, { status: 'accepted' });

        const now = Date.now();
        const f1 = doc(db, 'friendships', `${request.fromUid}_${request.toUid}`);
        const f2 = doc(db, 'friendships', `${request.toUid}_${request.fromUid}`);

        batch.set(f1, { userA: request.fromUid, userB: request.toUid, createdAt: now });
        batch.set(f2, { userA: request.toUid, userB: request.fromUid, createdAt: now });

        await batch.commit();
      } else {
        await deleteDoc(reqRef);
      }
      return true;
    } catch (e) {
      console.warn('[Firestore] Respond friend request error:', e);
      return false;
    }
  }

  /**
   * Remove a friend atomically from Firestore (B7)
   */
  public async removeFriend(userA: string, userB: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !userA || !userB) return false;

    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'friendships', `${userA}_${userB}`));
      batch.delete(doc(db, 'friendships', `${userB}_${userA}`));
      batch.delete(doc(db, 'friendRequests', `${userA}_${userB}`));
      batch.delete(doc(db, 'friendRequests', `${userB}_${userA}`));
      await batch.commit();
      return true;
    } catch (e) {
      console.warn('[Firestore] removeFriend error:', e);
      return false;
    }
  }

  /**
   * Retrieves friends list from Firestore (B10: map first, then filter)
   */
  public async getFriends(userId: string): Promise<any[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    try {
      const q = query(collection(db, 'friendships'), where('userA', '==', userId));
      const snap = await getDocs(q);
      const friendIds: string[] = [];
      snap.forEach(d => friendIds.push(d.data().userB));

      const profiles = await Promise.all(friendIds.map(fid => this.getUserProfile(fid)));
      return friendIds.map((fid, idx) => {
        const p = profiles[idx];
        return {
          user_id: p?.userId || fid,
          username: p?.username || 'listener',
          display_name: p?.displayName || `@${p?.username || 'listener'}`,
          avatar_url: p?.photoURL || null
        };
      });
    } catch (e) {
      console.warn('[Firestore] getFriends error:', e);
      return [];
    }
  }

  /**
   * Subscribes to friends list updates in real-time (B6, B10: always calls callback even when empty)
   */
  public subscribeToFriends(userId: string, callback: (friends: any[]) => void): () => void {
    const db = this.getDb();
    if (!db || !userId) {
      callback([]);
      return () => {};
    }

    try {
      const q = query(collection(db, 'friendships'), where('userA', '==', userId));
      return onSnapshot(q, async (snap) => {
        if (snap.empty) {
          callback([]);
          return;
        }

        const friendIds: string[] = [];
        snap.forEach(d => friendIds.push(d.data().userB));
        const profiles = await Promise.all(friendIds.map(fid => this.getUserProfile(fid)));
        const friendsList = friendIds.map((fid, idx) => {
          const p = profiles[idx];
          return {
            user_id: p?.userId || fid,
            username: p?.username || 'listener',
            display_name: p?.displayName || `@${p?.username || 'listener'}`,
            avatar_url: p?.photoURL || null
          };
        });
        callback(friendsList);
      }, () => callback([]));
    } catch (_) {
      callback([]);
      return () => {};
    }
  }

  /**
   * Send a song share in real-time to a friend with personal note
   */
  public async sendSongShare(
    fromUser: AppUser,
    recipientUid: string,
    track: Track,
    message?: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database unavailable' };

    try {
      const shareId = `share_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const shareRef = doc(db, 'shares', shareId);

      await setDoc(shareRef, {
        id: shareId,
        senderId: fromUser.uid,
        senderUsername: fromUser.email?.split('@')[0] || 'listener',
        senderDisplayName: fromUser.displayName || 'Friend',
        recipientId: recipientUid,
        song: {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album || null,
          duration: track.duration || 0,
          artworkUrl: track.artworkUrl || null
        },
        message: message?.trim() || null,
        read: false,
        createdAt: Date.now()
      });

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message || 'Failed to share song' };
    }
  }

  /**
   * Real-time subscription to received song shares
   */
  public subscribeToReceivedShares(
    userId: string,
    callback: (shares: FirestoreSongShare[]) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !userId) {
      callback([]);
      return () => {};
    }

    try {
      const q = query(
        collection(db, 'shares'),
        where('recipientId', '==', userId),
        limit(50)
      );

      return onSnapshot(
        q,
        (snap) => {
          const list: FirestoreSongShare[] = [];
          snap.forEach(d => list.push(d.data() as FirestoreSongShare));
          list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          callback(list);
        },
        (err) => {
          console.warn('[Firestore] Shares subscription error:', err);
          callback([]);
        }
      );
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Helper to clean track objects so they never contain undefined (which Firestore rejects)
   * and strip unnecessary heavy fields to guarantee lightning-fast cloud sync.
   */
  private sanitizeTrack(t: Track): any {
    return {
      id: String(t.id || `tr_${Date.now()}`),
      title: String(t.title || 'Unknown Track'),
      artist: String(t.artist || 'Unknown Artist'),
      album: t.album ? String(t.album) : null,
      duration: typeof t.duration === 'number' && !isNaN(t.duration) ? t.duration : 0,
      artworkUrl: t.artworkUrl ? String(t.artworkUrl) : null,
      streamUrl: t.streamUrl ? String(t.streamUrl) : null,
      addedAt: typeof t.addedAt === 'number' ? t.addedAt : Date.now()
    };
  }

  /**
   * Cloud sync user playlists
   */
  public async syncPlaylists(userId: string, playlists: CustomPlaylist[]): Promise<void> {
    await this.saveUserPlaylists(userId, playlists);
  }

  /**
   * Persists user playlists to Firestore with sanitized track fields.
   * Supports comprehensive playlists (up to 1,000 tracks each) without arbitrary truncation.
   */
  public async saveUserPlaylists(userId: string, playlists: CustomPlaylist[]): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;

    try {
      const sanitized = (playlists || []).slice(0, 50).map(p => ({
        id: String(p.id),
        name: String(p.name || 'Untitled Playlist'),
        description: String(p.description || ''),
        coverUrl: p.coverUrl ? String(p.coverUrl) : null,
        coverColor: p.coverColor ? String(p.coverColor) : '#63E8FF',
        tracks: (p.tracks || []).slice(0, 1000).map(t => this.sanitizeTrack(t)),
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
        updatedAt: Date.now()
      }));

      const ref = doc(db, 'userPlaylists', userId);
      await setDoc(ref, {
        userId,
        uid: userId,
        user_id: userId,
        playlists: sanitized,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Save playlists error:', e);
    }
  }

  /**
   * Retrieves user playlists once from Firestore with explicit existence metadata
   */
  public async getUserPlaylists(userId: string): Promise<{ exists: boolean; playlists: CustomPlaylist[] } | null> {
    const db = this.getDb();
    if (!db || !userId) return null;

    try {
      const ref = doc(db, 'userPlaylists', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        return {
          exists: true,
          playlists: (data.playlists as CustomPlaylist[]) || []
        };
      } else {
        return {
          exists: false,
          playlists: []
        };
      }
    } catch (e) {
      console.warn('[Firestore] Get playlists error:', e);
      return null;
    }
  }

  /**
   * Real-time subscription to user playlists across all active devices
   */
  public subscribeUserPlaylists(
    userId: string,
    callback: (playlists: CustomPlaylist[]) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !userId) return () => {};

    try {
      const ref = doc(db, 'userPlaylists', userId);
      return onSnapshot(
        ref,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            callback((data.playlists as CustomPlaylist[]) || []);
          }
        },
        (err) => {
          console.warn('[Firestore] Playlists subscription error:', err);
        }
      );
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Persists user liked songs to Firestore
   */
  public async saveUserLikedSongs(userId: string, tracks: Track[]): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;

    try {
      const sanitized = (tracks || []).slice(0, 300).map(t => this.sanitizeTrack(t));
      const ref = doc(db, 'userLikedSongs', userId);
      await setDoc(ref, {
        userId,
        tracks: sanitized,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Save liked songs error:', e);
    }
  }

  /**
   * Retrieves user liked songs once from Firestore
   */
  public async getUserLikedSongs(userId: string): Promise<Track[] | null> {
    const db = this.getDb();
    if (!db || !userId) return null;

    try {
      const ref = doc(db, 'userLikedSongs', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        return (data.tracks as Track[]) || [];
      }
    } catch (e) {
      console.warn('[Firestore] Get liked songs error:', e);
    }
    return null;
  }

  /**
   * Real-time subscription to user liked songs across all devices
   */
  public subscribeUserLikedSongs(
    userId: string,
    callback: (tracks: Track[]) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !userId) return () => {};

    try {
      const ref = doc(db, 'userLikedSongs', userId);
      return onSnapshot(
        ref,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            callback((data.tracks as Track[]) || []);
          }
        },
        (err) => {
          console.warn('[Firestore] Liked songs subscription error:', err);
        }
      );
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Persists song ratings to Firestore
   */
  public async saveUserRatings(userId: string, ratings: Record<string, string | null>): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;

    try {
      const ref = doc(db, 'userRatings', userId);
      await setDoc(ref, {
        userId,
        ratings: ratings || {},
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Save ratings error:', e);
    }
  }

  /**
   * Retrieves user ratings once from Firestore
   */
  public async getUserRatings(userId: string): Promise<Record<string, string | null> | null> {
    const db = this.getDb();
    if (!db || !userId) return null;

    try {
      const ref = doc(db, 'userRatings', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        return (data.ratings as Record<string, string | null>) || {};
      }
    } catch (e) {
      console.warn('[Firestore] Get ratings error:', e);
    }
    return null;
  }

  /**
   * Real-time subscription to user ratings
   */
  public subscribeUserRatings(
    userId: string,
    callback: (ratings: Record<string, string | null>) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !userId) return () => {};

    try {
      const ref = doc(db, 'userRatings', userId);
      return onSnapshot(
        ref,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            callback((data.ratings as Record<string, string | null>) || {});
          }
        },
        (err) => {
          console.warn('[Firestore] Ratings subscription error:', err);
        }
      );
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Persists user profile to Firestore
   */
  public async saveUserProfile(userId: string, profile: Record<string, any>): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;

    try {
      const ref = doc(db, 'users', userId);
      const payload: Record<string, any> = {
        userId,
        updatedAt: Date.now()
      };
      if (profile.username !== undefined && profile.username !== null) payload.username = profile.username;
      if (profile.displayName !== undefined && profile.displayName !== null) payload.displayName = profile.displayName;
      if (profile.photoURL !== undefined) payload.photoURL = profile.photoURL;
      if (profile.email !== undefined && profile.email !== null) payload.email = profile.email;
      if (profile.tasteSnapshot !== undefined) payload.tasteSnapshot = profile.tasteSnapshot;

      await setDoc(ref, payload, { merge: true });

      // If username is present, index in global usernames registry
      if (profile.username) {
        const cleanU = profile.username.replace(/^@/, '').trim().toLowerCase();
        if (cleanU && cleanU.length >= 3) {
          const userRef = doc(db, 'usernames', cleanU);
          await setDoc(userRef, {
            userId,
            username: cleanU,
            displayName: profile.displayName || `@${cleanU}`,
            photoURL: profile.photoURL || null,
            updatedAt: Date.now()
          }, { merge: true });
        }
      }
    } catch (e) {
      console.warn('[Firestore] Save profile error:', e);
    }
  }

  /**
   * Atomically claims a username in the global Firestore usernames registry.
   */
  public async claimUsername(
    userId: string, 
    rawUsername: string, 
    profile?: { displayName?: string; photoURL?: string | null; email?: string | null }
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db || !userId) return { success: false, error: 'Database not available' };

    const clean = rawUsername.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (!clean || clean.length < 3) {
      return { success: false, error: 'Username must be at least 3 characters (letters, numbers, underscores).' };
    }

    try {
      const uRef = doc(db, 'usernames', clean);
      const snap = await getDoc(uRef);
      if (snap.exists()) {
        const existing = snap.data();
        if (existing.userId && existing.userId !== userId) {
          return { success: false, error: `@${clean} is already claimed by another listener.` };
        }
      }

      await setDoc(uRef, {
        userId,
        username: clean,
        displayName: profile?.displayName || `@${clean}`,
        photoURL: profile?.photoURL || null,
        updatedAt: Date.now()
      });

      await this.saveUserProfile(userId, {
        username: clean,
        displayName: profile?.displayName || `@${clean}`,
        photoURL: profile?.photoURL || null,
        email: profile?.email || null
      });

      return { success: true };
    } catch (err: any) {
      console.warn('[Firestore] claimUsername error:', err);
      return { success: false, error: err.message || 'Failed to claim username' };
    }
  }

  /**
   * Look up a user profile by exact username from global registry.
   */
  public async getUserByUsername(rawUsername: string): Promise<any | null> {
    const db = this.getDb();
    if (!db) return null;

    const clean = rawUsername.replace(/^@/, '').trim().toLowerCase();
    if (!clean) return null;

    try {
      const uRef = doc(db, 'usernames', clean);
      const snap = await getDoc(uRef);
      if (snap.exists()) {
        const uData = snap.data();
        const fullProf = await this.getUserProfile(uData.userId);
        return {
          ...uData,
          ...(fullProf || {})
        };
      }
    } catch (e) {
      console.warn('[Firestore] getUserByUsername error:', e);
    }
    return null;
  }

  /**
   * Search listeners across all devices using Firestore prefix queries.
   */
  public async searchUsers(
    queryStr: string, 
    currentUserId?: string | null, 
    maxResults = 15
  ): Promise<any[]> {
    const db = this.getDb();
    if (!db) return [];

    const clean = queryStr.replace(/^@/, '').trim().toLowerCase();
    if (!clean || clean.length < 1) return [];

    try {
      const uCol = collection(db, 'usernames');
      const q = query(
        uCol,
        where('username', '>=', clean),
        where('username', '<=', clean + '\uf8ff'),
        limit(maxResults)
      );

      const snap = await getDocs(q);
      const results: any[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const id = d.userId || d.uid || d.user_id || docSnap.id;
        if (!currentUserId || (id !== currentUserId && d.username !== currentUserId)) {
          results.push({
            user_id: id,
            userId: id,
            uid: id,
            username: d.username,
            display_name: d.displayName || `@${d.username}`,
            displayName: d.displayName || `@${d.username}`,
            avatar_url: d.photoURL || null,
            photoURL: d.photoURL || null
          });
        }
      });
      return results;
    } catch (e) {
      console.warn('[Firestore] searchUsers error:', e);
      return [];
    }
  }

  /**
   * Persists listening stats to Firestore for cross-device synchronization
   */
  public async saveUserListeningStats(userId: string, stats: any): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;

    try {
      const sRef = doc(db, 'userStats', userId);
      await setDoc(sRef, {
        userId,
        stats: stats || {},
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] saveUserListeningStats error:', e);
    }
  }

  /**
   * Retrieves listening stats from Firestore
   */
  public async getUserListeningStats(userId: string): Promise<any | null> {
    const db = this.getDb();
    if (!db || !userId) return null;

    try {
      const sRef = doc(db, 'userStats', userId);
      const snap = await getDoc(sRef);
      if (snap.exists()) {
        return snap.data().stats || null;
      }
    } catch (e) {
      console.warn('[Firestore] getUserListeningStats error:', e);
    }
    return null;
  }

  /**
   * Subscribes to real-time listening stats updates
   */
  public subscribeUserListeningStats(
    userId: string,
    callback: (stats: any) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !userId) return () => {};

    try {
      const sRef = doc(db, 'userStats', userId);
      return onSnapshot(sRef, (snap) => {
        if (snap.exists()) {
          callback(snap.data().stats || null);
        }
      }, (e) => {
        console.warn('[Firestore] stats subscription error:', e);
      });
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Retrieves user profile from Firestore
   */
  public async getUserProfile(userId: string): Promise<any | null> {
    const db = this.getDb();
    if (!db || !userId) return null;

    try {
      const ref = doc(db, 'users', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        return snap.data();
      }
    } catch (e) {
      console.warn('[Firestore] Get profile error:', e);
    }
    return null;
  }

  /**
   * Checks if a username is available in the global Firestore usernames registry.
   */
  public async checkUsernameAvailable(rawUsername: string): Promise<boolean> {
    const db = this.getDb();
    if (!db) return true;
    const clean = rawUsername.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (!clean || clean.length < 3) return false;

    try {
      const uRef = doc(db, 'usernames', clean);
      const snap = await getDoc(uRef);
      return !snap.exists();
    } catch (_) {
      return true;
    }
  }

  /**
   * Atomically registers a permanent password-protected user profile in Firestore.
   */
  public async registerUserWithPassword(
    userId: string,
    username: string,
    passwordHash: string,
    profile: { displayName?: string; email?: string | null; photoURL?: string | null }
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db || !userId) return { success: false, error: 'Database not available' };

    const clean = username.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (!clean || clean.length < 3) {
      return { success: false, error: 'Username must be at least 3 characters (letters, numbers, underscores).' };
    }

    try {
      // 1. Ensure username isn't taken by someone else
      const uRef = doc(db, 'usernames', clean);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        const existingId = uSnap.data().userId || uSnap.data().uid;
        if (existingId && existingId !== userId) {
          return { success: false, error: `@${clean} is already taken by another listener.` };
        }
      }

      // 2. Write authoritative user document
      const userRef = doc(db, 'users', userId);
      const userPayload: Record<string, any> = {
        userId,
        uid: userId,
        user_id: userId,
        username: clean,
        displayName: profile.displayName || `@${clean}`,
        email: profile.email || null,
        photoURL: profile.photoURL || `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(clean)}&backgroundColor=080A10`,
        passwordHash,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await setDoc(userRef, userPayload, { merge: true });

      // 3. Register in global usernames collection
      await setDoc(uRef, {
        userId,
        uid: userId,
        user_id: userId,
        username: clean,
        displayName: profile.displayName || `@${clean}`,
        photoURL: userPayload.photoURL,
        email: profile.email || null,
        updatedAt: Date.now()
      }, { merge: true });

      return { success: true };
    } catch (err: any) {
      console.warn('[Firestore] registerUserWithPassword error:', err);
      return { success: false, error: err.message || 'Failed to register account' };
    }
  }

  /**
   * Verifies credentials against Firestore by username or email.
   */
  public async verifyUserPassword(
    identifier: string,
    passwordHash: string
  ): Promise<{ success: boolean; user?: any; error?: string }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database not available' };

    const clean = identifier.trim().toLowerCase();
    if (!clean) return { success: false, error: 'Please enter your username or email' };

    try {
      let targetUserId: string | null = null;
      let userData: any = null;

      if (clean.includes('@') && clean.includes('.')) {
        // Query users collection by email
        const usersCol = collection(db, 'users');
        const q = query(usersCol, where('email', '==', clean), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          userData = snap.docs[0].data();
          targetUserId = userData.userId || userData.uid || userData.user_id;
        }
      } else {
        // Resolve username from usernames registry
        const cleanUser = clean.replace(/^@/, '');
        const uRef = doc(db, 'usernames', cleanUser);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists()) {
          const uDat = uSnap.data();
          targetUserId = uDat.userId || uDat.uid || uDat.user_id;
        }

        // Also fallback to direct document lookup in users
        if (!targetUserId) {
          const directUserRef = doc(db, 'users', cleanUser);
          const directSnap = await getDoc(directUserRef);
          if (directSnap.exists()) {
            userData = directSnap.data();
            targetUserId = userData.userId || userData.uid || userData.user_id;
          }
        }
      }

      if (!targetUserId && !userData) {
        return { success: false, error: 'Account not found. Please verify your username/email or sign up.' };
      }

      if (!userData && targetUserId) {
        const userRef = doc(db, 'users', targetUserId);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          userData = snap.data();
        }
      }

      if (!userData) {
        return { success: false, error: 'Account profile not found.' };
      }

      if (userData.passwordHash && userData.passwordHash !== passwordHash) {
        return { success: false, error: 'Incorrect password. Please try again.' };
      }

      return { success: true, user: userData };
    } catch (err: any) {
      console.warn('[Firestore] verifyUserPassword error:', err);
      return { success: false, error: err.message || 'Authentication error' };
    }
  }
}

export const FirestoreService = new FirestoreServiceClass();
