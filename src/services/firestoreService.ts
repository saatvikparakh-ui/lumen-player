/**
 * LUMEN FIRESTORE REAL-TIME SOCIAL & CLOUD SYNC SERVICE
 * Provides multi-device real-time presence (Now Listening to),
 * global friend requests, real-time song sharing with personal notes,
 * and cloud playlist synchronization across any network.
 */

import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
  runTransaction,
  documentId
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
        try {
          this.db = initializeFirestore(app, {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
          });
        } catch (_) {
          this.db = getFirestore(app);
        }
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
        where(documentId(), '>=', clean),
        where(documentId(), '<=', clean + '\uf8ff'),
        limit(12)
      );

      const snapshot = await getDocs(q);
      const results: Array<{ uid: string; userId: string; user_id: string; username: string; displayName: string }> = [];
      snapshot.forEach(d => {
        const data = d.data();
        const id = data.userId || data.uid || data.user_id || d.id;
        const handle = data.username || d.id;
        results.push({
          uid: id,
          userId: id,
          user_id: id,
          username: handle,
          displayName: data.displayName || `@${handle}`
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
  /**
   * Atomically claims a username and initializes public and private user profiles.
   * usernames/{lowercaseName} -> { uid, createdAt }
   * users/{uid} -> { username, displayName, photoURL, createdAt }
   * users/{uid}/private/account -> { email, privacy: { ratingVisibility: 'public' }, createdAt }
   */
  public async claimUsernameAndCreateProfile(
    uid: string,
    username: string,
    displayName: string,
    email: string | null,
    photoURL?: string | null
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db || !uid) return { success: false, error: 'Database not available' };

    const clean = username.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);
    if (!clean || clean.length < 3) {
      return { success: false, error: 'Username must be between 3 and 20 characters (a-z, 0-9, _, .).' };
    }

    const reserved = ['admin', 'administrator', 'lumen', 'support', 'help', 'root', 'system', 'official'];
    if (reserved.includes(clean)) {
      return { success: false, error: `The username @${clean} is reserved.` };
    }

    try {
      await runTransaction(db, async (txn) => {
        const uRef = doc(db, 'usernames', clean);
        const uSnap = await txn.get(uRef);
        if (uSnap.exists()) {
          const data = uSnap.data();
          if (data.uid !== uid) {
            throw new Error(`@${clean} is already claimed by another user.`);
          }
        }

        // 1. Claim in usernames collection:
        txn.set(uRef, {
          username: clean,
          uid,
          displayName: displayName || `@${clean}`,
          photoURL: photoURL || null,
          createdAt: serverTimestamp()
        });

        // 2. Set public profile in users/{uid}: No email, no hashes, no tokens!
        const userRef = doc(db, 'users', uid);
        txn.set(userRef, {
          username: clean,
          displayName: displayName || `@${clean}`,
          photoURL: photoURL || null,
          createdAt: serverTimestamp()
        }, { merge: true });

        // 3. Set private account document in users/{uid}/private/account
        if (email) {
          const privRef = doc(db, 'users', uid, 'private', 'account');
          txn.set(privRef, {
            email,
            privacy: { ratingVisibility: 'public' },
            createdAt: serverTimestamp()
          }, { merge: true });
        }
      });

      return { success: true };
    } catch (err: any) {
      console.warn('[Firestore] claimUsernameAndCreateProfile error:', err);
      return { success: false, error: err.message || 'Failed to claim username.' };
    }
  }

  /**
   * Alias for claimUsernameAndCreateProfile
   */
  public async claimUsername(
    userId: string, 
    rawUsername: string, 
    profile?: { displayName?: string; photoURL?: string | null; email?: string | null }
  ): Promise<{ success: boolean; error?: string }> {
    return this.claimUsernameAndCreateProfile(
      userId,
      rawUsername,
      profile?.displayName || `@${rawUsername}`,
      profile?.email || null,
      profile?.photoURL || null
    );
  }

  /**
   * Atomically changes username: creates new username record, deletes old, and updates user profile.
   */
  public async changeUsername(
    uid: string,
    oldUsername: string,
    newUsername: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db || !uid) return { success: false, error: 'Database not available' };

    const cleanOld = oldUsername.replace(/^@/, '').trim().toLowerCase();
    const cleanNew = newUsername.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);

    if (!cleanNew || cleanNew.length < 3) {
      return { success: false, error: 'New username must be at least 3 characters.' };
    }

    const reserved = ['admin', 'administrator', 'lumen', 'support', 'help', 'root', 'system', 'official'];
    if (reserved.includes(cleanNew)) {
      return { success: false, error: `The username @${cleanNew} is reserved.` };
    }

    try {
      await runTransaction(db, async (txn) => {
        const newRef = doc(db, 'usernames', cleanNew);
        const newSnap = await txn.get(newRef);
        if (newSnap.exists()) {
          const data = newSnap.data();
          if (data.uid !== uid) {
            throw new Error(`@${cleanNew} is already taken.`);
          }
        }

        txn.set(newRef, {
          uid,
          createdAt: serverTimestamp()
        });

        if (cleanOld && cleanOld !== cleanNew) {
          const oldRef = doc(db, 'usernames', cleanOld);
          txn.delete(oldRef);
        }

        const userRef = doc(db, 'users', uid);
        txn.update(userRef, {
          username: cleanNew,
          updatedAt: serverTimestamp()
        });
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update username' };
    }
  }

  public async isUsernameTaken(rawUsername: string): Promise<boolean> {
    const db = this.getDb();
    if (!db) return false;
    const clean = rawUsername.replace(/^@/, '').trim().toLowerCase();
    if (!clean) return false;
    try {
      const snap = await getDoc(doc(db, 'usernames', clean));
      return snap.exists();
    } catch (_) {
      return false;
    }
  }

  public async deleteUserData(uid: string): Promise<void> {
    const db = this.getDb();
    if (!db || !uid) return;
    try {
      const prof = await this.getUserProfile(uid);
      if (prof?.username) {
        await deleteDoc(doc(db, 'usernames', prof.username));
      }
      await deleteDoc(doc(db, 'users', uid));
      await deleteDoc(doc(db, 'users', uid, 'private', 'account'));
      await deleteDoc(doc(db, 'presence', uid));
    } catch (e) {
      console.warn('[Firestore] deleteUserData error:', e);
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
        where(documentId(), '>=', clean),
        where(documentId(), '<=', clean + '\uf8ff'),
        limit(maxResults)
      );

      const snap = await getDocs(q);
      const results: any[] = [];
      const seenIds = new Set<string>();

      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const handle = d.username || docSnap.id;
        const id = d.uid || d.userId || d.user_id;
        if (id && (!currentUserId || id !== currentUserId) && !seenIds.has(id)) {
          seenIds.add(id);
          results.push({
            user_id: id,
            userId: id,
            uid: id,
            username: handle,
            display_name: d.displayName || `@${handle}`,
            displayName: d.displayName || `@${handle}`,
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

  // =========================================================================
  // ITEM-LEVEL USER STORES (Phase 3: Cross-Device Sync)
  // =========================================================================

  // 1. Liked Tracks: users/{uid}/likes/{trackId}
  public async likeTrack(uid: string, track: Track): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !track?.id) return;
    try {
      const ref = doc(db, 'users', uid, 'likes', String(track.id));
      await setDoc(ref, {
        id: String(track.id),
        title: String(track.title || 'Unknown Title'),
        artist: String(track.artist || 'Unknown Artist'),
        album: track.album ? String(track.album) : null,
        duration: Number(track.duration) || 0,
        artworkUrl: track.artworkUrl ? String(track.artworkUrl) : null,
        likedAt: Date.now(),
        updatedAt: serverTimestamp(),
        deleted: false
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] likeTrack error:', e);
    }
  }

  public async unlikeTrack(uid: string, trackId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !trackId) return;
    try {
      const ref = doc(db, 'users', uid, 'likes', String(trackId));
      await deleteDoc(ref);
    } catch (e) {
      console.warn('[Firestore] unlikeTrack error:', e);
    }
  }

  public subscribeUserLikes(
    uid: string,
    callback: (tracks: Track[], fromCache: boolean) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !uid) {
      callback([], false);
      return () => {};
    }
    try {
      const col = collection(db, 'users', uid, 'likes');
      return onSnapshot(col, (snapshot) => {
        const fromCache = snapshot.metadata.fromCache;
        const tracks: Track[] = [];
        snapshot.forEach(docSnap => {
          const d = docSnap.data();
          if (!d.deleted) {
            tracks.push({
              id: d.id,
              title: d.title || 'Unknown Title',
              artist: d.artist || 'Unknown Artist',
              album: d.album || '',
              duration: d.duration || 0,
              artworkUrl: d.artworkUrl || undefined,
              path: '',
              filename: '',
              hasArtwork: Boolean(d.artworkUrl),
              streamUrl: '',
              addedAt: d.likedAt || Date.now()
            } as Track);
          }
        });
        tracks.sort((a, b) => ((b.addedAt || 0) - (a.addedAt || 0)));
        callback(tracks, fromCache);
      }, (err) => {
        console.warn('[Firestore] subscribeUserLikes error:', err);
      });
    } catch (_) {
      return () => {};
    }
  }

  // 2. Playlists: users/{uid}/playlists/{playlistId} & tracks/{trackId}
  public async savePlaylistMeta(uid: string, playlist: CustomPlaylist): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !playlist?.id) return;
    try {
      const pRef = doc(db, 'users', uid, 'playlists', String(playlist.id));
      await setDoc(pRef, {
        id: String(playlist.id),
        name: String(playlist.name || 'Untitled Playlist'),
        description: String(playlist.description || ''),
        coverUrl: playlist.coverUrl ? String(playlist.coverUrl) : null,
        coverColor: playlist.coverColor ? String(playlist.coverColor) : '#63E8FF',
        createdAt: playlist.createdAt || Date.now(),
        updatedAt: serverTimestamp(),
        deleted: false
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] savePlaylistMeta error:', e);
    }
  }

  public async deletePlaylistDoc(uid: string, playlistId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !playlistId) return;
    try {
      const pRef = doc(db, 'users', uid, 'playlists', String(playlistId));
      await deleteDoc(pRef);
    } catch (e) {
      console.warn('[Firestore] deletePlaylistDoc error:', e);
    }
  }

  public async addPlaylistTrack(
    uid: string,
    playlistId: string,
    track: Track,
    position: number
  ): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !playlistId || !track?.id) return;
    try {
      const tRef = doc(db, 'users', uid, 'playlists', String(playlistId), 'tracks', String(track.id));
      await setDoc(tRef, {
        id: String(track.id),
        title: String(track.title || 'Unknown Title'),
        artist: String(track.artist || 'Unknown Artist'),
        album: track.album ? String(track.album) : null,
        duration: Number(track.duration) || 0,
        artworkUrl: track.artworkUrl ? String(track.artworkUrl) : null,
        position,
        addedAt: Date.now(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      const pRef = doc(db, 'users', uid, 'playlists', String(playlistId));
      await updateDoc(pRef, { updatedAt: serverTimestamp() }).catch(() => {});
    } catch (e) {
      console.warn('[Firestore] addPlaylistTrack error:', e);
    }
  }

  public async removePlaylistTrack(
    uid: string,
    playlistId: string,
    trackId: string
  ): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !playlistId || !trackId) return;
    try {
      const tRef = doc(db, 'users', uid, 'playlists', String(playlistId), 'tracks', String(trackId));
      await deleteDoc(tRef);

      const pRef = doc(db, 'users', uid, 'playlists', String(playlistId));
      await updateDoc(pRef, { updatedAt: serverTimestamp() }).catch(() => {});
    } catch (e) {
      console.warn('[Firestore] removePlaylistTrack error:', e);
    }
  }

  public subscribePlaylists(
    uid: string,
    callback: (playlists: CustomPlaylist[], fromCache: boolean) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !uid) {
      callback([], false);
      return () => {};
    }
    try {
      const pCol = collection(db, 'users', uid, 'playlists');
      return onSnapshot(pCol, async (snapshot) => {
        const fromCache = snapshot.metadata.fromCache;
        const playlists: CustomPlaylist[] = [];

        for (const docSnap of snapshot.docs) {
          const d = docSnap.data();
          if (!d.deleted) {
            playlists.push({
              id: d.id,
              name: d.name,
              description: d.description || '',
              coverUrl: d.coverUrl || null,
              coverColor: d.coverColor || '#63E8FF',
              tracks: [],
              createdAt: d.createdAt || Date.now(),
              updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : (d.updatedAt?.toMillis?.() || Date.now())
            });
          }
        }

        await Promise.all(playlists.map(async (pl) => {
          try {
            const tCol = collection(db, 'users', uid, 'playlists', pl.id, 'tracks');
            const tSnap = await getDocs(tCol);
            const tracks: (Track & { position?: number })[] = [];
            tSnap.forEach(tDoc => {
              const td = tDoc.data();
              tracks.push({
                id: td.id,
                title: td.title,
                artist: td.artist,
                album: td.album || undefined,
                duration: td.duration || 0,
                artworkUrl: td.artworkUrl || undefined,
                addedAt: td.addedAt || Date.now(),
                position: typeof td.position === 'number' ? td.position : 0
              } as any);
            });
            tracks.sort((a, b) => ((a as any).position || 0) - ((b as any).position || 0));
            pl.tracks = tracks;
          } catch (_) {}
        }));

        callback(playlists, fromCache);
      }, (err) => {
        console.warn('[Firestore] subscribePlaylists error:', err);
      });
    } catch (_) {
      return () => {};
    }
  }

  // 3. Ratings: users/{uid}/ratings/{trackId}
  public async setTrackRating(
    uid: string,
    trackId: string,
    score: number,
    formatted: string
  ): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !trackId) return;
    try {
      const rRef = doc(db, 'users', uid, 'ratings', String(trackId));
      await setDoc(rRef, {
        trackId: String(trackId),
        score,
        formatted,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] setTrackRating error:', e);
    }
  }

  public async deleteTrackRating(uid: string, trackId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !trackId) return;
    try {
      const rRef = doc(db, 'users', uid, 'ratings', String(trackId));
      await deleteDoc(rRef);
    } catch (e) {
      console.warn('[Firestore] deleteTrackRating error:', e);
    }
  }

  public subscribeUserRatingsCollection(
    uid: string,
    callback: (ratings: Record<string, string>) => void
  ): () => void {
    const db = this.getDb();
    if (!db || !uid) {
      callback({});
      return () => {};
    }
    try {
      const col = collection(db, 'users', uid, 'ratings');
      return onSnapshot(col, (snapshot) => {
        const map: Record<string, string> = {};
        snapshot.forEach(docSnap => {
          const d = docSnap.data();
          if (d.trackId && d.formatted) {
            map[d.trackId] = d.formatted;
          }
        });
        callback(map);
      }, (err) => {
        console.warn('[Firestore] subscribeUserRatingsCollection error:', err);
      });
    } catch (_) {
      return () => {};
    }
  }
}

export const FirestoreService = new FirestoreServiceClass();
