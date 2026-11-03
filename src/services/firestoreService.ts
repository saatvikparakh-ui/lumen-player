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
  limit
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

    const cleanUsername = username.trim().toLowerCase().replace(/^@/, '');
    if (!cleanUsername || cleanUsername.length < 3) {
      return { success: false, error: 'Username must be at least 3 characters' };
    }

    try {
      const usernameRef = doc(db, 'usernames', cleanUsername);
      const existing = await getDoc(usernameRef);
      if (existing.exists() && existing.data().uid !== uid) {
        return { success: false, error: 'Username is already taken' };
      }

      await setDoc(usernameRef, {
        uid,
        username: cleanUsername,
        displayName,
        updatedAt: Date.now()
      });

      // Also save in user profile
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { username: cleanUsername, displayName }, { merge: true });

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
        limit(8)
      );

      const snapshot = await getDocs(q);
      const results: Array<{ uid: string; username: string; displayName: string }> = [];
      snapshot.forEach(d => {
        results.push(d.data() as any);
      });
      return results;
    } catch (err) {
      console.warn('[Firestore] User search error:', err);
      return [];
    }
  }

  /**
   * Send a friend request via Firestore
   */
  public async sendFriendRequest(
    fromUser: AppUser,
    toUid: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    if (fromUser.uid === toUid) return { success: false, error: 'Cannot friend yourself' };

    try {
      const reqId = `${fromUser.uid}_${toUid}`;
      const reqRef = doc(db, 'friendRequests', reqId);

      await setDoc(reqRef, {
        id: reqId,
        fromUid: fromUser.uid,
        fromUsername: fromUser.email?.split('@')[0] || 'listener',
        fromDisplayName: fromUser.displayName || 'Listener',
        fromPhotoURL: fromUser.photoURL || null,
        toUid,
        status: 'pending',
        createdAt: Date.now()
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send friend request' };
    }
  }

  /**
   * Listen to incoming friend requests in real time
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
   * Accept or decline a friend request
   */
  public async respondToFriendRequest(
    request: FirestoreFriendRequest,
    accept: boolean
  ): Promise<boolean> {
    const db = this.getDb();
    if (!db) return false;

    try {
      const reqRef = doc(db, 'friendRequests', request.id);
      if (accept) {
        await updateDoc(reqRef, { status: 'accepted' });

        // Record bidirectional friendship
        const f1 = doc(db, 'friendships', `${request.fromUid}_${request.toUid}`);
        const f2 = doc(db, 'friendships', `${request.toUid}_${request.fromUid}`);
        const now = Date.now();
        await Promise.all([
          setDoc(f1, { userA: request.fromUid, userB: request.toUid, createdAt: now }),
          setDoc(f2, { userA: request.toUid, userB: request.fromUid, createdAt: now })
        ]);
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
        orderBy('createdAt', 'desc'),
        limit(20)
      );

      return onSnapshot(
        q,
        (snap) => {
          const list: FirestoreSongShare[] = [];
          snap.forEach(d => list.push(d.data() as FirestoreSongShare));
          callback(list);
        },
        (err) => {
          // If indexing error or offline, fallback safely
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
   */
  private sanitizeTrack(t: Track): any {
    return {
      id: t.id || `tr_${Date.now()}`,
      title: t.title || 'Unknown Track',
      artist: t.artist || 'Unknown Artist',
      album: t.album || null,
      duration: typeof t.duration === 'number' ? t.duration : 0,
      artworkUrl: t.artworkUrl || null,
      streamUrl: t.streamUrl || null,
      addedAt: t.addedAt || Date.now()
    };
  }

  /**
   * Cloud sync user playlists
   */
  public async syncPlaylists(userId: string, playlists: CustomPlaylist[]): Promise<void> {
    await this.saveUserPlaylists(userId, playlists);
  }

  /**
   * Persists user playlists to Firestore with sanitized track fields
   */
  public async saveUserPlaylists(userId: string, playlists: CustomPlaylist[]): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;

    try {
      const sanitized = (playlists || []).slice(0, 50).map(p => ({
        id: p.id,
        name: p.name || 'Untitled Playlist',
        description: p.description || '',
        coverUrl: p.coverUrl || null,
        coverColor: p.coverColor || '#63E8FF',
        tracks: (p.tracks || []).slice(0, 200).map(t => this.sanitizeTrack(t)),
        createdAt: p.createdAt || Date.now(),
        updatedAt: Date.now()
      }));

      const ref = doc(db, 'userPlaylists', userId);
      await setDoc(ref, {
        userId,
        playlists: sanitized,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Save playlists error:', e);
    }
  }

  /**
   * Retrieves user playlists once from Firestore
   */
  public async getUserPlaylists(userId: string): Promise<CustomPlaylist[] | null> {
    const db = this.getDb();
    if (!db || !userId) return null;

    try {
      const ref = doc(db, 'userPlaylists', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        return (data.playlists as CustomPlaylist[]) || [];
      }
    } catch (e) {
      console.warn('[Firestore] Get playlists error:', e);
    }
    return null;
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
  public async saveUserProfile(userId: string, profile: { username?: string; displayName?: string; photoURL?: string | null; email?: string | null }): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;

    try {
      const ref = doc(db, 'users', userId);
      await setDoc(ref, {
        userId,
        username: profile.username || null,
        displayName: profile.displayName || profile.username || 'Listener',
        photoURL: profile.photoURL || null,
        email: profile.email || null,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Save profile error:', e);
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
}

export const FirestoreService = new FirestoreServiceClass();
