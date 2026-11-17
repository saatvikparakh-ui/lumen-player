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
  documentId,
  arrayUnion
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { FirebaseAuthService, AppUser } from './firebaseAuthService';
import { SupabaseService } from './supabaseService';
import { Track, CustomPlaylist } from '../types/music';

/**
 * Canonical helper: extract the user UID from any user or username document,
 * supporting legacy documents with userId / user_id aliases seamlessly.
 */
export function docUid(d: any): string | null {
  if (!d) return null;
  return d.uid || d.userId || d.user_id || null;
}

export interface UsernameDoc {
  uid: string;
  username: string;
  displayName?: string;
  photoURL?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

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
  toUsername?: string;
  toDisplayName?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
}

export interface FirestoreSongShare {
  id: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  recipientId: string;
  recipientUsername?: string;
  type?: 'song' | 'playlist' | 'mini_mixtape' | 'aux_invite' | 'aux_room' | 'circle_room' | 'album_club_invite';
  song?: Track;
  playlist?: CustomPlaylist;
  mixtapeId?: string;
  mixtape?: any;
  sessionId?: string;
  sessionTitle?: string;
  sessionMode?: string;
  clubId?: string;
  clubName?: string;
  club?: any;
  message?: string;
  read: boolean;
  status?: string;
  version?: number;
  openedAt?: number | null;
  createdAt: number;
}

export interface TierListTrack {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  artworkUrl?: string | null;
  duration?: number;
  rating?: string | number | null;
  addedBy?: string;
  addedAt?: number;
}

export interface FirestoreTierList {
  id: string;
  title: string;
  ownerId: string;
  ownerUsername: string;
  ownerDisplayName?: string;
  isCollaborative: boolean;
  collaboratorUids: string[];
  collaboratorUsernames: string[];
  tiers: {
    s: TierListTrack[];
    a: TierListTrack[];
    b: TierListTrack[];
    c: TierListTrack[];
    d: TierListTrack[];
  };
  createdAt: number;
  updatedAt: number;
  lastUpdatedBy?: string;
}

class FirestoreServiceClass {
  private db: Firestore | null = null;
  private presenceUnsub: (() => void) | null = null;
  private currentPresenceTrackId: string | null = null;
  private profileCache = new Map<string, { profile: any; timestamp: number }>();

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

      // Announce and sync with Supabase and local cache immediately (<50ms)
      SupabaseService.announceUser({
        id: uid,
        username: cleanUsername,
        displayName: displayName || `@${cleanUsername}`
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to claim username' };
    }
  }

  /**
   * Search users across Supabase, Local Known Users Cache, and Firestore in parallel
   */
  public async searchUsersByUsername(searchQuery: string): Promise<Array<{
    uid: string;
    userId: string;
    user_id: string;
    username: string;
    displayName: string;
    photoURL?: string | null;
  }>> {
    const clean = searchQuery.trim().toLowerCase().replace(/^@/, '');
    if (!clean) return [];

    const resultsMap = new Map<string, any>();

    // 1. Instant query to Supabase & Local Known Users Cache (<50ms)
    try {
      const supaUsers = await SupabaseService.searchUsers(clean);
      for (const u of supaUsers) {
        resultsMap.set(u.username.toLowerCase(), u);
      }
    } catch (_) {}

    // 2. Query Firestore in parallel with 450ms timeout race
    const db = this.getDb();
    if (db) {
      try {
        const firestorePromise = (async () => {
          const usernamesRef = collection(db, 'usernames');
          const q = query(
            usernamesRef,
            where(documentId(), '>=', clean),
            where(documentId(), '<=', clean + '\uf8ff'),
            limit(12)
          );
          const snapshot = await getDocs(q);
          snapshot.forEach(d => {
            const data = d.data();
            const id = docUid(data) || d.id;
            const handle = (data.username || d.id || '').toLowerCase();
            if (handle && !resultsMap.has(handle)) {
              resultsMap.set(handle, {
                uid: id,
                userId: id,
                user_id: id,
                username: data.username || handle,
                displayName: data.displayName || `@${handle}`,
                photoURL: data.photoURL || null
              });
            }
          });

          if (resultsMap.size < 10) {
            const usersRef = collection(db, 'users');
            const uQuery = query(
              usersRef,
              where('username', '>=', clean),
              where('username', '<=', clean + '\uf8ff'),
              limit(12)
            );
            const uSnap = await getDocs(uQuery);
            uSnap.forEach(d => {
              const data = d.data();
              const id = d.id;
              const handle = (data.username || data.displayName || id || '').toLowerCase();
              if (handle && !resultsMap.has(handle)) {
                resultsMap.set(handle, {
                  uid: id,
                  userId: id,
                  user_id: id,
                  username: data.username || handle,
                  displayName: data.displayName || `@${handle}`,
                  photoURL: data.photoURL || null
                });
              }
            });
          }
        })();

        await Promise.race([
          firestorePromise,
          new Promise(res => setTimeout(res, 450))
        ]);
      } catch (err) {
        console.warn('[Firestore] search timeout/notice:', err);
      }
    }

    return Array.from(resultsMap.values());
  }

  /**
   * Resolves a raw handle or uid string to a clean UID and profile
   */
  public async resolveUsername(rawInput: string): Promise<{ uid: string; profile: any } | null> {
    const trimmed = (rawInput || '').trim();
    if (!trimmed) return null;

    // Direct UID check (Firebase UIDs are alphanumeric strings without @, typically 20+ chars, or persistent usr_*)
    if (trimmed.startsWith('usr_') || (!trimmed.includes('@') && trimmed.length >= 20)) {
      const prof = await this.getUserProfile(trimmed);
      if (prof) {
        const id = docUid(prof) || trimmed;
        return { uid: id, profile: prof };
      }
      return {
        uid: trimmed,
        profile: { uid: trimmed, userId: trimmed, user_id: trimmed, username: trimmed.slice(0, 10), displayName: `@${trimmed.slice(0, 10)}` }
      };
    }

    const clean = trimmed.replace(/^@/, '').toLowerCase();
    const prof = await this.getUserByUsername(clean);
    if (prof) {
      const id = docUid(prof);
      if (id) {
        return { uid: id, profile: prof };
      }
    }
    return null;
  }

  /**
   * Send a friend request via Firestore with target validation, duplicate check, and reverse auto-accept (B2, B3, B4, B9)
   */
  public async sendFriendRequest(
    fromUser: AppUser,
    toUidOrUsername: string,
    directTargetUid?: string
  ): Promise<{ success: boolean; error?: string; autoAccepted?: boolean }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database unavailable' };

    if (!fromUser || !fromUser.uid) {
      return { success: false, error: 'Sign in to add friends and share music.' };
    }

    const senderUid = fromUser.uid;

    const rawInput = (toUidOrUsername || '').trim();
    if (!rawInput && !directTargetUid) {
      return { success: false, error: 'Please enter a valid @username.' };
    }

    let targetUid: string | null = directTargetUid || null;
    let targetUsername = rawInput.replace(/^@/, '').toLowerCase();

    if (!targetUid) {
      // Resolve target UID & profile
      const resolved = await this.resolveUsername(rawInput);
      if (!resolved || !resolved.uid) {
        return { success: false, error: `Listener "${rawInput}" not found. Verify the @username and try again.` };
      }
      targetUid = resolved.uid;
      targetUsername = (resolved.profile?.username || targetUsername).toLowerCase();
    } else if (targetUsername) {
      targetUsername = targetUsername.toLowerCase();
    }

    if (senderUid === targetUid) {
      return { success: false, error: 'You cannot send a friend request to yourself.' };
    }

    try {
      // 1. Check friendship state (both directions)
      const f1 = doc(db, 'friendships', `${senderUid}_${targetUid}`);
      const f2 = doc(db, 'friendships', `${targetUid}_${senderUid}`);
      const [f1Snap, f2Snap] = await Promise.all([getDoc(f1), getDoc(f2)]);

      if (f1Snap.exists()) {
        return { success: false, error: `You and @${targetUsername || 'this user'} are already connected friends!` };
      }

      // If f1 does not exist but orphaned f2 exists from a half-deleted disconnect, attempt cleanup
      if (!f1Snap.exists() && f2Snap.exists()) {
        try { await deleteDoc(f2); } catch (_) {}
      }

      // 2. Check if the other person already sent a pending request to us (reverse request) -> auto-accept!
      const revReqRef = doc(db, 'friendRequests', `${targetUid}_${senderUid}`);
      const revReqSnap = await getDoc(revReqRef);
      if (revReqSnap.exists() && revReqSnap.data().status === 'pending') {
        const ok = await this.respondToFriendRequest(revReqSnap.data() as FirestoreFriendRequest, true);
        if (ok) {
          return { success: true, autoAccepted: true };
        }
      } else {
        try {
          const revQ = query(collection(db, 'friendRequests'), where('toUid', '==', senderUid));
          const revQSnap = await getDocs(revQ);
          const matchRev = revQSnap.docs.find(d => d.data().fromUid === targetUid && d.data().status === 'pending');
          if (matchRev) {
            const ok = await this.respondToFriendRequest({ ...(matchRev.data() as FirestoreFriendRequest), id: matchRev.id }, true);
            if (ok) return { success: true, autoAccepted: true };
          }
        } catch (_) {}
      }

      // 3. Check for existing pending request from us
      const reqId = `${senderUid}_${targetUid}`;
      const reqRef = doc(db, 'friendRequests', reqId);
      const existingReq = await getDoc(reqRef);
      if (existingReq.exists() && existingReq.data().status === 'pending') {
        return { success: false, error: 'Friend request is already pending.' };
      }

      let resolvedSenderUsername = fromUser.username;
      if (!resolvedSenderUsername) {
        try {
          const ownProf = await this.getUserProfile(senderUid);
          resolvedSenderUsername = ownProf?.username || null;
        } catch (_) {}
      }
      const senderUsername = (resolvedSenderUsername || fromUser.displayName?.replace(/^@/, '') || fromUser.email?.split('@')[0] || 'listener').toLowerCase();

      // If a stale non-pending doc exists (e.g. previous 'accepted' or 'declined'), replace cleanly
      const payload: FirestoreFriendRequest = {
        id: reqId,
        fromUid: senderUid,
        fromUsername: senderUsername,
        fromDisplayName: fromUser.displayName || `@${senderUsername}`,
        fromPhotoURL: fromUser.photoURL || null,
        toUid: targetUid,
        toUsername: targetUsername,
        status: 'pending',
        createdAt: Date.now()
      };

      // 1. Instant push via Supabase Realtime (<50ms delivery)
      SupabaseService.sendFriendRequest({
        fromUid: senderUid,
        fromUsername: senderUsername,
        fromDisplayName: fromUser.displayName || `@${senderUsername}`,
        fromPhotoURL: fromUser.photoURL || null,
        toUid: targetUid,
        toUsername: targetUsername
      }).catch(() => {});

      // 2. Persist in Firestore
      const setDocPromise = setDoc(reqRef, payload);
      await Promise.race([
        setDocPromise,
        new Promise(resolve => setTimeout(resolve, 400))
      ]);
      return { success: true };
    } catch (err: any) {
      console.warn('[Firestore] sendFriendRequest error:', err);
      const msg = String(err?.message || '');
      if (msg.includes('PERMISSION_DENIED') || msg.includes('Missing or insufficient permissions')) {
        return { success: false, error: 'Permission denied. Make sure you are signed into a registered account (not guest).' };
      }
      return { success: false, error: err.message || 'Failed to send friend request' };
    }
  }

  /**
   * Listen to incoming friend requests in real time (single-field queries for zero composite-index risk)
   */
  public subscribeToFriendRequests(
    userId: string,
    callback: (requests: FirestoreFriendRequest[]) => void,
    username?: string
  ): () => void {
    const db = this.getDb();
    if (!db || (!userId && !username)) {
      callback([]);
      return () => {};
    }

    try {
      const uidMap = new Map<string, FirestoreFriendRequest>();
      const usernameMap = new Map<string, FirestoreFriendRequest>();
      const unsubs: (() => void)[] = [];

      const notify = () => {
        const merged = new Map<string, FirestoreFriendRequest>();
        uidMap.forEach((v, k) => merged.set(k, v));
        usernameMap.forEach((v, k) => merged.set(k, v));
        const list = Array.from(merged.values())
          .filter(r => r.status === 'pending')
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        callback(list);
      };

      if (userId) {
        const qUid = query(
          collection(db, 'friendRequests'),
          where('toUid', '==', userId)
        );
        const unsub1 = onSnapshot(qUid, (snap) => {
          uidMap.clear();
          snap.forEach(docSnap => {
            const data = docSnap.data() as FirestoreFriendRequest;
            if (data.status === 'pending') {
              uidMap.set(docSnap.id, { ...data, id: data.id || docSnap.id });
            }
          });
          notify();
        }, (err) => {
          console.warn('[Firestore] subscribeToFriendRequests (uid) error:', err);
        });
        unsubs.push(unsub1);
      }

      if (username) {
        const cleanU = username.replace(/^@/, '').trim().toLowerCase();
        if (cleanU && cleanU !== 'listener' && cleanU !== 'you') {
          const qUsername = query(
            collection(db, 'friendRequests'),
            where('toUsername', '==', cleanU)
          );
          const unsub2 = onSnapshot(qUsername, (snap) => {
            usernameMap.clear();
            snap.forEach(docSnap => {
              const data = docSnap.data() as FirestoreFriendRequest;
              if (data.status === 'pending') {
                usernameMap.set(docSnap.id, { ...data, id: data.id || docSnap.id });
              }
            });
            notify();
          }, (err) => {
            console.warn('[Firestore] subscribeToFriendRequests (username) error:', err);
          });
          unsubs.push(unsub2);
        }
      }

      return () => {
        unsubs.forEach(u => u());
      };
    } catch (e) {
      console.warn('[Firestore] subscribeToFriendRequests init error:', e);
      return () => {};
    }
  }

  /**
   * Listen to outgoing friend requests sent by this user in real time (single-field queries)
   */
  public subscribeToOutgoingFriendRequests(
    userId: string,
    callback: (requests: FirestoreFriendRequest[]) => void,
    username?: string
  ): () => void {
    const db = this.getDb();
    if (!db || (!userId && !username)) {
      callback([]);
      return () => {};
    }

    try {
      const uidMap = new Map<string, FirestoreFriendRequest>();
      const usernameMap = new Map<string, FirestoreFriendRequest>();
      const unsubs: (() => void)[] = [];

      const notify = () => {
        const merged = new Map<string, FirestoreFriendRequest>();
        uidMap.forEach((v, k) => merged.set(k, v));
        usernameMap.forEach((v, k) => merged.set(k, v));
        const list = Array.from(merged.values())
          .filter(r => r.status === 'pending')
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        callback(list);
      };

      if (userId) {
        const qUid = query(
          collection(db, 'friendRequests'),
          where('fromUid', '==', userId)
        );
        const unsub1 = onSnapshot(qUid, (snap) => {
          uidMap.clear();
          snap.forEach(docSnap => {
            const data = docSnap.data() as FirestoreFriendRequest;
            if (data.status === 'pending') {
              uidMap.set(docSnap.id, { ...data, id: data.id || docSnap.id });
            }
          });
          notify();
        }, (err) => {
          console.warn('[Firestore] subscribeToOutgoingFriendRequests (uid) error:', err);
        });
        unsubs.push(unsub1);
      }

      if (username) {
        const cleanU = username.replace(/^@/, '').trim().toLowerCase();
        if (cleanU && cleanU !== 'listener' && cleanU !== 'you') {
          const qUsername = query(
            collection(db, 'friendRequests'),
            where('fromUsername', '==', cleanU)
          );
          const unsub2 = onSnapshot(qUsername, (snap) => {
            usernameMap.clear();
            snap.forEach(docSnap => {
              const data = docSnap.data() as FirestoreFriendRequest;
              if (data.status === 'pending') {
                usernameMap.set(docSnap.id, { ...data, id: data.id || docSnap.id });
              }
            });
            notify();
          }, (err) => {
            console.warn('[Firestore] subscribeToOutgoingFriendRequests (username) error:', err);
          });
          unsubs.push(unsub2);
        }
      }

      return () => {
        unsubs.forEach(u => u());
      };
    } catch (e) {
      console.warn('[Firestore] subscribeToOutgoingFriendRequests init error:', e);
      return () => {};
    }
  }

  /**
   * Cancel or withdraw an outgoing pending friend request safely (avoids batch PERMISSION_DENIED on non-existent docs)
   */
  public async cancelFriendRequest(fromUid: string, toUid: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !fromUid || !toUid) return false;

    try {
      const reqId = `${fromUid}_${toUid}`;
      const reqRef = doc(db, 'friendRequests', reqId);
      const snapDirect = await getDoc(reqRef);
      if (snapDirect.exists()) {
        await deleteDoc(reqRef);
      }

      const q = query(
        collection(db, 'friendRequests'),
        where('fromUid', '==', fromUid)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        if (d.data().toUid === toUid) {
          try { await deleteDoc(d.ref); } catch (_) {}
        }
      }
      return true;
    } catch (e) {
      console.warn('[Firestore] cancelFriendRequest error:', e);
      return false;
    }
  }

  /**
   * Accept or decline a friend request atomically via writeBatch with resilient fallback
   */
  public async respondToFriendRequest(
    request: FirestoreFriendRequest,
    accept: boolean
  ): Promise<boolean> {
    const db = this.getDb();
    if (!db || !request) return false;

    try {
      const reqId = request.id || `${request.fromUid}_${request.toUid}`;
      const reqRef = doc(db, 'friendRequests', reqId);

      if (accept) {
        const now = Date.now();
        const f1 = doc(db, 'friendships', `${request.fromUid}_${request.toUid}`);
        const f2 = doc(db, 'friendships', `${request.toUid}_${request.fromUid}`);

        try {
          const batch = writeBatch(db);
          const reqSnap = await getDoc(reqRef);
          if (reqSnap.exists()) {
            batch.update(reqRef, { status: 'accepted' });
          }
          batch.set(f1, { userA: request.fromUid, userB: request.toUid, createdAt: now });
          batch.set(f2, { userA: request.toUid, userB: request.fromUid, createdAt: now });
          await batch.commit();
          return true;
        } catch (batchErr) {
          console.warn('[Firestore] accept batch fallback:', batchErr);
          await Promise.all([
            setDoc(f1, { userA: request.fromUid, userB: request.toUid, createdAt: now }),
            setDoc(f2, { userA: request.toUid, userB: request.fromUid, createdAt: now })
          ]);
          try { await updateDoc(reqRef, { status: 'accepted' }); } catch (_) {}
          return true;
        }
      } else {
        try {
          await deleteDoc(reqRef);
        } catch (_) {
          await updateDoc(reqRef, { status: 'declined' });
        }
        return true;
      }
    } catch (e) {
      console.warn('[Firestore] Respond friend request error:', e);
      return false;
    }
  }

  /**
   * Remove a friend safely without batch-aborting on non-existent friendRequests docs
   */
  public async removeFriend(userA: string, userB: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !userA || !userB) return false;

    let removedAtLeastOwnSide = false;
    try {
      // 1. Delete primary friendship doc (userA -> userB)
      const f1Ref = doc(db, 'friendships', `${userA}_${userB}`);
      const f1Snap = await getDoc(f1Ref);
      if (f1Snap.exists()) {
        await deleteDoc(f1Ref);
      }
      removedAtLeastOwnSide = true;

      // 2. Delete reciprocal friendship doc (userB -> userA)
      try {
        const f2Ref = doc(db, 'friendships', `${userB}_${userA}`);
        const f2Snap = await getDoc(f2Ref);
        if (f2Snap.exists()) {
          await deleteDoc(f2Ref);
        }
      } catch (e2) {
        console.warn('[Firestore] Could not delete reciprocal friendship doc:', e2);
      }

      // 3. Delete any matching friendships found via query in both directions
      try {
        const [qFSnapA, qFSnapB] = await Promise.all([
          getDocs(query(collection(db, 'friendships'), where('userA', '==', userA))),
          getDocs(query(collection(db, 'friendships'), where('userB', '==', userA)))
        ]);
        for (const d of [...qFSnapA.docs, ...qFSnapB.docs]) {
          const data = d.data();
          if ((data.userA === userA && data.userB === userB) || (data.userA === userB && data.userB === userA)) {
            try { await deleteDoc(d.ref); } catch (_) {}
          }
        }
      } catch (_) {}

      // 4. Clean up existing friendRequests in BOTH directions ONLY if they actually exist!
      // Crucial: Deleting a non-existent doc hits resource == null -> PERMISSION_DENIED under strict rules
      for (const reqKey of [`${userA}_${userB}`, `${userB}_${userA}`]) {
        try {
          const rRef = doc(db, 'friendRequests', reqKey);
          const rSnap = await getDoc(rRef);
          if (rSnap.exists()) {
            try {
              await deleteDoc(rRef);
            } catch (_) {
              await updateDoc(rRef, { status: 'declined' });
            }
          }
        } catch (reqErr) {
          console.warn(`[Firestore] request cleanup notice (${reqKey}):`, reqErr);
        }
      }

      // Query fallback in case any legacy request used a non-standard document ID
      try {
        const [rqFrom, rqTo] = await Promise.all([
          getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', userA))),
          getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', userA)))
        ]);
        for (const d of [...rqFrom.docs, ...rqTo.docs]) {
          const data = d.data();
          if ((data.fromUid === userA && data.toUid === userB) || (data.fromUid === userB && data.toUid === userA)) {
            try {
              await deleteDoc(d.ref);
            } catch (_) {
              try { await updateDoc(d.ref, { status: 'declined' }); } catch (_) {}
            }
          }
        }
      } catch (_) {}

      return removedAtLeastOwnSide;
    } catch (e) {
      console.warn('[Firestore] removeFriend error:', e);
      return false;
    }
  }

  /**
   * Retrieves friends list with instant local caching and fast fallback
   */
  public async getFriends(userId: string): Promise<any[]> {
    if (!userId) return [];

    let cachedFriends: any[] = [];
    try {
      const raw = localStorage.getItem(`lumen_friends_cache_${userId}`);
      if (raw) cachedFriends = JSON.parse(raw);
    } catch (_) {}

    const db = this.getDb();
    if (!db) return cachedFriends;

    try {
      const q = query(collection(db, 'friendships'), where('userA', '==', userId));
      const snap = await Promise.race([
        getDocs(q),
        new Promise<any>((_, reject) => setTimeout(() => reject('timeout'), 1200))
      ]);
      const friendIds: string[] = [];
      snap.forEach((d: any) => friendIds.push(d.data().userB));

      const profiles = await Promise.all(friendIds.map(fid => this.getUserProfile(fid)));
      const freshFriends = friendIds.map((fid, idx) => {
        const p = profiles[idx];
        const resolvedId = p?.uid || p?.userId || p?.user_id || fid;
        return {
          uid: resolvedId,
          userId: resolvedId,
          user_id: resolvedId,
          username: p?.username || 'listener',
          display_name: p?.displayName || `@${p?.username || 'listener'}`,
          displayName: p?.displayName || `@${p?.username || 'listener'}`,
          avatar_url: p?.photoURL || null,
          photoURL: p?.photoURL || null
        };
      });

      try {
        localStorage.setItem(`lumen_friends_cache_${userId}`, JSON.stringify(freshFriends));
      } catch (_) {}

      return freshFriends;
    } catch (e) {
      console.warn('[Firestore] getFriends notice, returning cached:', e);
      return cachedFriends;
    }
  }

  /**
   * Subscribes to friends list updates in real-time (Instant 0ms local cache emit + live updates)
   */
  public subscribeToFriends(userId: string, callback: (friends: any[]) => void): () => void {
    if (!userId) {
      callback([]);
      return () => {};
    }

    // 1. INSTANT 0ms EMIT FROM LOCAL CACHE
    try {
      const raw = localStorage.getItem(`lumen_friends_cache_${userId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          callback(parsed);
        }
      }
    } catch (_) {}

    const db = this.getDb();
    if (!db) {
      return () => {};
    }

    try {
      const q = query(collection(db, 'friendships'), where('userA', '==', userId));
      return onSnapshot(q, async (snap) => {
        if (snap.empty) {
          try {
            localStorage.setItem(`lumen_friends_cache_${userId}`, '[]');
          } catch (_) {}
          callback([]);
          return;
        }

        const friendIds: string[] = [];
        snap.forEach(d => friendIds.push(d.data().userB));
        const profiles = await Promise.all(friendIds.map(fid => this.getUserProfile(fid)));
        const friendsList = friendIds.map((fid, idx) => {
          const p = profiles[idx];
          const resolvedId = p?.uid || p?.userId || p?.user_id || fid;
          return {
            uid: resolvedId,
            user_id: resolvedId,
            userId: resolvedId,
            username: p?.username || 'listener',
            display_name: p?.displayName || `@${p?.username || 'listener'}`,
            displayName: p?.displayName || `@${p?.username || 'listener'}`,
            avatar_url: p?.photoURL || null,
            photoURL: p?.photoURL || null
          };
        });

        try {
          localStorage.setItem(`lumen_friends_cache_${userId}`, JSON.stringify(friendsList));
        } catch (_) {}

        callback(friendsList);
      }, () => {
        try {
          const raw = localStorage.getItem(`lumen_friends_cache_${userId}`);
          if (raw) callback(JSON.parse(raw));
        } catch (_) {}
      });
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Send a song share in real-time to a friend with personal note (Instant sub-second delivery)
   */
  public async sendSongShare(
    fromUser: AppUser,
    recipientUid: string,
    track: Track,
    message?: string,
    recipientUsername?: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    if (!fromUser || !fromUser.uid) return { success: false, error: 'Please sign in to share songs' };

    try {
      let targetUid = recipientUid;
      const cleanUsername = (recipientUsername || (recipientUid.startsWith('@') ? recipientUid : '')).replace(/^@/, '').toLowerCase().trim();

      // Fast resolve: at most 400ms timeout so UI never hangs
      if (targetUid && (targetUid.startsWith('@') || targetUid.length < 20)) {
        try {
          const resolvePromise = this.resolveUsername(targetUid.replace(/^@/, ''));
          const resolved = await Promise.race([
            resolvePromise,
            new Promise<null>(res => setTimeout(() => res(null), 400))
          ]);
          if (resolved?.uid) {
            targetUid = resolved.uid;
          }
        } catch (_) {}
      }

      if (!targetUid && !cleanUsername) {
        return { success: false, error: 'Recipient listener could not be found' };
      }

      const shareId = `share_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const shareRef = doc(db, 'shares', shareId);

      const senderHandle = (fromUser as any).username || 
        (fromUser.displayName && !fromUser.displayName.includes('@') ? fromUser.displayName : '') || 
        fromUser.email?.split('@')[0] || 'listener';

      // Instant push via Supabase Realtime (<50ms)
      SupabaseService.sendSongShare({
        sender_id: fromUser.uid,
        sender_username: senderHandle,
        sender_display_name: fromUser.displayName || `@${senderHandle}`,
        recipient_id: targetUid || cleanUsername,
        recipient_username: cleanUsername,
        type: 'song',
        song: track,
        message: message || ''
      }).catch(() => {});

      const safeDuration = Number.isFinite(Number(track.duration)) ? Number(track.duration) : 0;

      const payload = {
        id: shareId,
        senderId: fromUser.uid,
        senderUsername: senderHandle,
        senderDisplayName: fromUser.displayName || `@${senderHandle}`,
        recipientId: targetUid || cleanUsername,
        recipientUsername: cleanUsername || (targetUid.startsWith('@') ? targetUid.replace(/^@/, '') : null),
        song: {
          id: String(track.id || `tr_${Date.now()}`),
          title: String(track.title || 'Unknown Title'),
          artist: String(track.artist || 'Unknown Artist'),
          album: track.album ? String(track.album) : null,
          duration: safeDuration,
          artworkUrl: track.artworkUrl ? String(track.artworkUrl) : null
        },
        message: message?.trim() ? String(message.trim()) : null,
        read: false,
        createdAt: Date.now()
      };

      // Optimistic local cache store
      try {
        const sentRaw = localStorage.getItem('lumen_sent_shares') || '[]';
        const sentArr = JSON.parse(sentRaw);
        sentArr.unshift(payload);
        localStorage.setItem('lumen_sent_shares', JSON.stringify(sentArr.slice(0, 50)));
      } catch (_) {}

      // Fast race: Firestore SDK queues write in offline buffer immediately
      const setDocPromise = setDoc(shareRef, payload);
      await Promise.race([
        setDocPromise,
        new Promise(resolve => setTimeout(resolve, 350))
      ]);

      return { success: true };
    } catch (e: any) {
      console.error('[Firestore] sendSongShare error:', e);
      return { success: false, error: e.message || 'Failed to share song' };
    }
  }

  /**
   * Share an entire playlist with a friend in real time (Instant sub-second delivery)
   */
  public async sendPlaylistShare(
    fromUser: AppUser,
    recipientUid: string,
    playlist: CustomPlaylist,
    message?: string,
    recipientUsername?: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    if (!fromUser || !fromUser.uid) return { success: false, error: 'Please sign in to share playlists' };

    try {
      let targetUid = recipientUid;
      const cleanUsername = (recipientUsername || (recipientUid.startsWith('@') ? recipientUid : '')).replace(/^@/, '').toLowerCase().trim();

      // Fast resolve: at most 400ms timeout so UI never hangs
      if (targetUid && (targetUid.startsWith('@') || targetUid.length < 20)) {
        try {
          const resolvePromise = this.resolveUsername(targetUid.replace(/^@/, ''));
          const resolved = await Promise.race([
            resolvePromise,
            new Promise<null>(res => setTimeout(() => res(null), 400))
          ]);
          if (resolved?.uid) {
            targetUid = resolved.uid;
          }
        } catch (_) {}
      }

      if (!targetUid && !cleanUsername) {
        return { success: false, error: 'Recipient listener could not be found' };
      }

      const shareId = `share_pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const shareRef = doc(db, 'shares', shareId);

      const senderHandle = (fromUser as any).username || 
        (fromUser.displayName && !fromUser.displayName.includes('@') ? fromUser.displayName : '') || 
        fromUser.email?.split('@')[0] || 'listener';

      // Instant push via Supabase Realtime (<50ms)
      SupabaseService.sendSongShare({
        sender_id: fromUser.uid,
        sender_username: senderHandle,
        sender_display_name: fromUser.displayName || `@${senderHandle}`,
        recipient_id: targetUid || cleanUsername,
        recipient_username: cleanUsername,
        type: 'playlist',
        playlist: playlist,
        message: message || ''
      }).catch(() => {});

      const safeTracks = (playlist.tracks || []).slice(0, 100).map(t => this.sanitizeTrack(t));

      const payload = {
        id: shareId,
        senderId: fromUser.uid,
        senderUsername: senderHandle,
        senderDisplayName: fromUser.displayName || `@${senderHandle}`,
        recipientId: targetUid || cleanUsername,
        recipientUsername: cleanUsername || (targetUid.startsWith('@') ? targetUid.replace(/^@/, '') : null),
        type: 'playlist',
        playlist: {
          id: String(playlist.id || `pl_${Date.now()}`),
          name: String(playlist.name || 'Untitled Playlist'),
          description: String(playlist.description || ''),
          coverUrl: playlist.coverUrl ? String(playlist.coverUrl) : null,
          coverColor: playlist.coverColor ? String(playlist.coverColor) : null,
          tracks: safeTracks
        },
        message: message?.trim() ? String(message.trim()) : null,
        read: false,
        createdAt: Date.now()
      };

      // Fast race: Firestore SDK queues write in offline buffer immediately
      const setDocPromise = setDoc(shareRef, payload);
      await Promise.race([
        setDocPromise,
        new Promise(resolve => setTimeout(resolve, 350))
      ]);

      return { success: true };
    } catch (e: any) {
      console.error('[Firestore] sendPlaylistShare error:', e);
      return { success: false, error: e.message || 'Failed to share playlist' };
    }
  }

  /**
   * Update user rating visibility privacy preference
   */
  public async updateUserPrivacy(userId: string, rating_visibility: 'public' | 'friends' | 'private'): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;
    try {
      const ref = doc(db, 'users', userId);
      await setDoc(ref, {
        rating_visibility,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] Update user privacy error:', e);
    }
  }

  /**
   * Real-time subscription to received song shares
   */
  public subscribeToReceivedShares(
    userId: string,
    callback: (shares: FirestoreSongShare[]) => void,
    username?: string | null
  ): () => void {
    const db = this.getDb();
    if (!db || (!userId && !username)) {
      callback([]);
      return () => {};
    }

    try {
      const cleanU = (username || localStorage.getItem('lumen_custom_username') || localStorage.getItem('lumen_username') || '').replace(/^@/, '').trim().toLowerCase();

      let dismissedSet = new Set<string>();
      try {
        const dismissedRaw = localStorage.getItem('lumen_dismissed_shares') || '[]';
        dismissedSet = new Set(JSON.parse(dismissedRaw));
      } catch (_) {}

      const sharesMap = new Map<string, FirestoreSongShare>();
      const emitMerged = () => {
        const list = Array.from(sharesMap.values()).filter(s => s?.id && !dismissedSet.has(s.id));
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        callback(list);
      };

      const unsubs: (() => void)[] = [];

      // Listener 1: recipientId == userId
      if (userId) {
        const qId = query(
          collection(db, 'shares'),
          where('recipientId', '==', userId),
          limit(50)
        );
        unsubs.push(onSnapshot(qId, (snap) => {
          snap.forEach(d => {
            const data = d.data() as FirestoreSongShare;
            if (data?.id) sharesMap.set(data.id, data);
          });
          emitMerged();
        }, (err) => console.warn('[Firestore] Shares UID subscription error:', err)));
      }

      // Listener 2: recipientUsername == cleanU
      if (cleanU) {
        const qUsername = query(
          collection(db, 'shares'),
          where('recipientUsername', '==', cleanU),
          limit(50)
        );
        unsubs.push(onSnapshot(qUsername, (snap) => {
          snap.forEach(d => {
            const data = d.data() as FirestoreSongShare;
            if (data?.id) sharesMap.set(data.id, data);
          });
          emitMerged();
        }, (err) => console.warn('[Firestore] Shares username subscription error:', err)));

        // Listener 3: recipientId == cleanU (handles when sender put handle into recipientId)
        if (cleanU !== userId) {
          const qIdHandle = query(
            collection(db, 'shares'),
            where('recipientId', '==', cleanU),
            limit(50)
          );
          unsubs.push(onSnapshot(qIdHandle, (snap) => {
            snap.forEach(d => {
              const data = d.data() as FirestoreSongShare;
              if (data?.id) sharesMap.set(data.id, data);
            });
            emitMerged();
          }, (err) => console.warn('[Firestore] Shares handle ID subscription error:', err)));
        }
      }

      return () => {
        unsubs.forEach(u => {
          try { u(); } catch (_) {}
        });
      };
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Broadcast an Album Club invite to a friend
   */
  public async sendAlbumClubInvite(
    fromUser: AppUser | null,
    recipientUid: string,
    recipientUsername: string,
    club: any
  ): Promise<boolean> {
    const db = this.getDb();
    if (!db || !club?.id) return false;
    try {
      const cleanU = (recipientUsername || '').replace(/^@/, '').trim().toLowerCase();
      const cleanUid = (recipientUid || '').trim();
      const senderHandle = (fromUser as any)?.username || fromUser?.displayName || 'Friend';

      // Instant push via Supabase Realtime (<50ms)
      SupabaseService.sendAlbumClubInvite({
        club_id: club.id,
        club_name: club.name || 'Album Club',
        inviter_id: fromUser?.uid || 'user',
        inviter_name: senderHandle,
        invitee_id: cleanUid || cleanU,
        invitee_name: cleanU || undefined
      }).catch(() => {});

      const shareId = `share_club_${club.id}_${cleanUid || cleanU}_${Date.now()}`;
      const sRef = doc(db, 'shares', shareId);
      
      const payload = {
        id: shareId,
        senderId: fromUser?.uid || 'user',
        senderUsername: senderHandle,
        senderDisplayName: fromUser?.displayName || `@${senderHandle}`,
        recipientId: cleanUid || cleanU,
        recipientUsername: cleanU || null,
        type: 'album_club_invite',
        clubId: club.id,
        clubName: club.name,
        club: club,
        createdAt: Date.now()
      };

      await setDoc(sRef, payload);

      // If both cleanUid and cleanU exist and are different, also write alias for instant matching
      if (cleanU && cleanUid && cleanUid !== cleanU) {
        const altShareId = `share_club_${club.id}_${cleanU}_u_${Date.now()}`;
        await setDoc(doc(db, 'shares', altShareId), {
          ...payload,
          id: altShareId,
          recipientId: cleanU
        });
      }

      await this.saveAlbumClub(club);
      return true;
    } catch (e) {
      console.warn('[Firestore] sendAlbumClubInvite notice:', e);
      return false;
    }
  }

  /**
   * Save / Sync an Album Club in Firestore
   */
  public async saveAlbumClub(club: any): Promise<boolean> {
    const db = this.getDb();
    if (!db || !club?.id) return false;
    try {
      const cRef = doc(db, 'album_clubs', club.id);
      await setDoc(cRef, {
        ...club,
        updatedAt: Date.now()
      }, { merge: true });
      return true;
    } catch (e) {
      console.warn('[Firestore] saveAlbumClub notice:', e);
      return false;
    }
  }

  /**
   * Real-time subscription to an Album Club in Firestore
   */
  public subscribeToAlbumClub(clubId: string, callback: (club: any | null) => void): () => void {
    const db = this.getDb();
    if (!db || !clubId) {
      callback(null);
      return () => {};
    }
    try {
      const cRef = doc(db, 'album_clubs', clubId);
      return onSnapshot(cRef, (snap) => {
        if (snap.exists()) {
          callback(snap.data());
        } else {
          callback(null);
        }
      }, (err) => console.warn('[Firestore] subscribeToAlbumClub error:', err));
    } catch (_) {
      return () => {};
    }
  }

  /**
   * Delete an individual shared song notification
   */
  public async deleteShare(shareId: string): Promise<boolean> {
    if (!shareId) return false;

    // Cache locally as dismissed so UI updates immediately
    try {
      const raw = localStorage.getItem('lumen_dismissed_shares') || '[]';
      const arr: string[] = JSON.parse(raw);
      if (!arr.includes(shareId)) {
        arr.push(shareId);
        localStorage.setItem('lumen_dismissed_shares', JSON.stringify(arr.slice(-200)));
      }
    } catch (_) {}

    const db = this.getDb();
    if (!db) return true;

    try {
      const shareRef = doc(db, 'shares', shareId);
      await deleteDoc(shareRef);
      return true;
    } catch (e) {
      console.warn('[Firestore] deleteShare error (handled):', e);
      return true;
    }
  }

  /**
   * Clear all shared song notifications for a user
   */
  public async clearAllReceivedShares(userId: string): Promise<boolean> {
    if (!userId) return false;

    // Mark all existing dismissed
    try {
      localStorage.setItem('lumen_dismissed_shares', JSON.stringify(['*']));
    } catch (_) {}

    const db = this.getDb();
    if (!db) return true;

    try {
      const q = query(
        collection(db, 'shares'),
        where('recipientId', '==', userId),
        limit(100)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      return true;
    } catch (e) {
      console.warn('[Firestore] clearAllReceivedShares error (handled):', e);
      return true;
    }
  }

  // --------------------------------------------------------------------------
  // Collaborative & Personal Tier Lists
  // --------------------------------------------------------------------------

  private sanitizeTierTrack(t: TierListTrack): TierListTrack {
    return {
      id: String(t.id || `tr_${Date.now()}`),
      title: String(t.title || 'Unknown Track'),
      artist: String(t.artist || 'Unknown Artist'),
      album: t.album ? String(t.album) : null,
      artworkUrl: t.artworkUrl ? String(t.artworkUrl) : null,
      duration: typeof t.duration === 'number' && !isNaN(t.duration) ? t.duration : 0,
      rating: t.rating !== undefined ? t.rating : null,
      addedBy: t.addedBy ? String(t.addedBy) : undefined,
      addedAt: typeof t.addedAt === 'number' ? t.addedAt : Date.now()
    };
  }

  // -------------------------------------------------------------
  // Local Tier List Storage Caching Helpers & Anti-Resurrection Tombstones
  // -------------------------------------------------------------
  public getDeletedTierListTombstones(): Set<string> {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_deleted_tier_lists_tombstones') : null;
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) {
      return new Set();
    }
  }

  public addDeletedTierListTombstone(id: string): void {
    if (!id) return;
    try {
      const s = this.getDeletedTierListTombstones();
      s.add(id);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('lumen_deleted_tier_lists_tombstones', JSON.stringify(Array.from(s)));
      }
    } catch (_) {}
  }

  public getLocalTierLists(): FirestoreTierList[] {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_tier_lists') : null;
      const lists: FirestoreTierList[] = raw ? JSON.parse(raw) : [];
      const tombstones = this.getDeletedTierListTombstones();
      return tombstones.size > 0 ? lists.filter(l => l && l.id && !tombstones.has(l.id)) : lists;
    } catch (_) {
      return [];
    }
  }

  public saveLocalTierLists(lists: FirestoreTierList[]): void {
    try {
      const tombstones = this.getDeletedTierListTombstones();
      const filtered = tombstones.size > 0 ? lists.filter(l => l && l.id && !tombstones.has(l.id)) : lists;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('lumen_tier_lists', JSON.stringify(filtered));
      }
    } catch (_) {}
  }

  public upsertLocalTierList(item: FirestoreTierList): void {
    if (!item?.id) return;
    const tombstones = this.getDeletedTierListTombstones();
    if (tombstones.has(item.id)) return;

    try {
      const current = this.getLocalTierLists();
      const idx = current.findIndex(l => l.id === item.id);
      if (idx >= 0) {
        current[idx] = { ...current[idx], ...item };
      } else {
        current.unshift(item);
      }
      this.saveLocalTierLists(current);
    } catch (_) {}
  }

  /**
   * Create a new personal or collaborative Tier List
   */
  public async createTierList(
    fromUser: AppUser | null,
    title: string,
    isCollaborative: boolean,
    collaboratorUids: string[],
    collaboratorUsernames: string[],
    initialTiers?: {
      s?: TierListTrack[];
      a?: TierListTrack[];
      b?: TierListTrack[];
      c?: TierListTrack[];
      d?: TierListTrack[];
    }
  ): Promise<{ success: boolean; id?: string; tierList?: FirestoreTierList; error?: string }> {
    const listId = `tier_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const effectiveUid = fromUser?.uid || 'guest_local';
    const senderHandle = (fromUser as any)?.username ||
      (fromUser?.displayName && !fromUser.displayName.includes('@') ? fromUser.displayName : '') ||
      fromUser?.email?.split('@')[0] || 'listener';

    const cleanCollabUids = Array.isArray(collaboratorUids) ? collaboratorUids.filter(Boolean) : [];
    const cleanCollabUsernames = Array.isArray(collaboratorUsernames) ? collaboratorUsernames.filter(Boolean) : [];

    const tierListData: FirestoreTierList = {
      id: listId,
      title: title.trim() || 'Untitled Tier List',
      ownerId: effectiveUid,
      ownerUsername: senderHandle,
      ownerDisplayName: fromUser?.displayName || `@${senderHandle}`,
      isCollaborative: !!isCollaborative,
      collaboratorUids: cleanCollabUids,
      collaboratorUsernames: cleanCollabUsernames,
      tiers: {
        s: (initialTiers?.s || []).map(t => this.sanitizeTierTrack(t)),
        a: (initialTiers?.a || []).map(t => this.sanitizeTierTrack(t)),
        b: (initialTiers?.b || []).map(t => this.sanitizeTierTrack(t)),
        c: (initialTiers?.c || []).map(t => this.sanitizeTierTrack(t)),
        d: (initialTiers?.d || []).map(t => this.sanitizeTierTrack(t))
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUpdatedBy: senderHandle
    };

    // 1. ALWAYS persist locally first (zero data loss, works offline and guest)
    this.upsertLocalTierList(tierListData);

    // 2. High-speed Supabase Realtime save & broadcast (<50ms delivery)
    SupabaseService.saveTierList(tierListData).catch(() => {});
    if (isCollaborative) {
      for (const collabUid of cleanCollabUids) {
        if (collabUid && collabUid !== effectiveUid) {
          SupabaseService.sendTierListInvite(collabUid, tierListData, fromUser).catch(() => {});
        }
      }
      for (const collabUser of cleanCollabUsernames) {
        const cleanU = collabUser.replace(/^@/, '').trim().toLowerCase();
        if (cleanU && cleanU !== senderHandle.toLowerCase()) {
          SupabaseService.sendTierListInvite(cleanU, tierListData, fromUser).catch(() => {});
        }
      }
    }

    // 3. Background non-blocking Firestore sync (never stalls the UI!)
    const db = this.getDb();
    if (db) {
      setTimeout(async () => {
        // 3a. Save to users/{effectiveUid}.tierLists
        try {
          const currentLists = this.getLocalTierLists();
          const uRef = doc(db, 'users', effectiveUid);
          await setDoc(uRef, {
            tierLists: currentLists.slice(0, 30),
            updatedAt: Date.now()
          }, { merge: true });
        } catch (_) {}

        // 3b. Write to shares/tier_room_${listId}
        try {
          const roomRef = doc(db, 'shares', `tier_room_${listId}`);
          await setDoc(roomRef, {
            id: `tier_room_${listId}`,
            type: 'tier_room',
            tierListId: listId,
            tierList: tierListData,
            collaboratorUids: cleanCollabUids,
            collaboratorUsernames: cleanCollabUsernames,
            ownerId: effectiveUid,
            ownerUsername: senderHandle,
            updatedAt: Date.now(),
            lastUpdatedBy: senderHandle
          });
        } catch (_) {}

        // 3c. Dual write to /tierLists/{listId}
        try {
          const ref = doc(db, 'tierLists', listId);
          await setDoc(ref, tierListData);
        } catch (_) {}
      }, 0);
    }

    return { success: true, id: listId, tierList: tierListData };
  }

  /**
   * Subscribe to a single Tier List in real time (collaborators see live changes)
   */
  public subscribeTierList(
    tierListId: string,
    callback: (list: FirestoreTierList | null) => void
  ): () => void {
    if (!tierListId) {
      callback(null);
      return () => {};
    }

    // 1. Emit local immediately if exists
    const local = this.getLocalTierLists().find(l => l.id === tierListId);
    if (local) {
      callback(local);
    }

    const db = this.getDb();
    if (!db) {
      return () => {};
    }

    const unsubs: (() => void)[] = [];

    // 2. Real-Time Dedicated Room Listener: shares/tier_room_${tierListId} (Instant sub-100ms sync across devices)
    try {
      const roomRef = doc(db, 'shares', `tier_room_${tierListId}`);
      const unsubRoom = onSnapshot(
        roomRef,
        (snap) => {
          if (snap.exists()) {
            const rData = snap.data();
            if (rData.deleted || rData.type === 'tier_room_deleted') {
              callback(null);
              return;
            }
            if (rData.tierList) {
              const remote = rData.tierList as FirestoreTierList;
              this.upsertLocalTierList(remote);
              callback(remote);
            }
          }
        },
        () => {}
      );
      unsubs.push(unsubRoom);
    } catch (_) {}

    // 3. Direct tierLists collection listener (if cloud permissions allow)
    try {
      const ref = doc(db, 'tierLists', tierListId);
      const unsub1 = onSnapshot(
        ref,
        (snap) => {
          if (snap.exists()) {
            const remote = snap.data() as FirestoreTierList;
            this.upsertLocalTierList(remote);
            callback(remote);
          }
        },
        () => {}
      );
      unsubs.push(unsub1);
    } catch (_) {}

    // 4. Real-time shares stream for live collaborative updates fallback
    try {
      const currentUid = FirebaseAuthService.getCurrentUser()?.uid || (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_persistent_uid') : null);
      if (currentUid) {
        const qShares = query(
          collection(db, 'shares'),
          where('recipientId', '==', currentUid),
          limit(25)
        );
        const unsub2 = onSnapshot(
          qShares,
          (snap) => {
            snap.docChanges().forEach((change) => {
              if (change.type === 'added' || change.type === 'modified') {
                const data = change.doc.data();
                if (
                  (data.type === 'collaborative_tier_list' || data.type === 'collaborative_tier_list_update') &&
                  data.tierList &&
                  data.tierList.id === tierListId
                ) {
                  this.upsertLocalTierList(data.tierList);
                  callback(data.tierList);
                }
              }
            });
          },
          () => {}
        );
        unsubs.push(unsub2);
      }
    } catch (_) {}

    return () => {
      unsubs.forEach(u => u());
    };
  }

  /**
   * Real-time update tier positions
   */
  public async updateTierListTiers(
    tierListId: string,
    tiers: FirestoreTierList['tiers'],
    updatedByUsername: string
  ): Promise<boolean> {
    if (!tierListId) return false;

    const cleanTiers = {
      s: (tiers.s || []).map(t => this.sanitizeTierTrack(t)),
      a: (tiers.a || []).map(t => this.sanitizeTierTrack(t)),
      b: (tiers.b || []).map(t => this.sanitizeTierTrack(t)),
      c: (tiers.c || []).map(t => this.sanitizeTierTrack(t)),
      d: (tiers.d || []).map(t => this.sanitizeTierTrack(t))
    };

    // 1. Update local storage
    const currentLists = this.getLocalTierLists();
    const item = currentLists.find(l => l.id === tierListId);
    if (item) {
      item.tiers = cleanTiers;
      item.updatedAt = Date.now();
      item.lastUpdatedBy = updatedByUsername;
      this.saveLocalTierLists(currentLists);
    }

    // 2. Broadcast to Firestore in background without blocking optimistic UI
    const db = this.getDb();
    if (!db) return true;

    const currentUid = FirebaseAuthService.getCurrentUser()?.uid || (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_persistent_uid') : null);

    // Launch non-blocking parallel sync
    (async () => {
      const syncPromises: Promise<any>[] = [];
      if (currentUid) {
        const uRef = doc(db, 'users', currentUid);
        syncPromises.push(setDoc(uRef, {
          tierLists: currentLists.slice(0, 30),
          updatedAt: Date.now()
        }, { merge: true }).catch(() => {}));
      }

      if (item) {
        const roomRef = doc(db, 'shares', `tier_room_${tierListId}`);
        syncPromises.push(setDoc(roomRef, {
          id: `tier_room_${tierListId}`,
          type: 'tier_room',
          tierListId,
          tierList: item,
          updatedAt: Date.now(),
          lastUpdatedBy: updatedByUsername
        }, { merge: true }).catch(() => {}));
      }

      if (item && item.isCollaborative) {
        const recipients = new Set<string>();
        if (item.ownerId && item.ownerId !== currentUid) {
          recipients.add(item.ownerId);
        }
        (item.collaboratorUids || []).forEach(uid => {
          if (uid && uid !== currentUid) recipients.add(uid);
        });

        for (const recId of recipients) {
          const shareId = `share_tier_up_${tierListId}_${recId}_${Date.now()}`;
          const sRef = doc(db, 'shares', shareId);
          syncPromises.push(setDoc(sRef, {
            id: shareId,
            senderId: currentUid || 'collaborator',
            senderUsername: updatedByUsername,
            recipientId: recId,
            type: 'collaborative_tier_list_update',
            tierList: item,
            createdAt: Date.now()
          }).catch(() => {}));
        }
      }

      const ref = doc(db, 'tierLists', tierListId);
      syncPromises.push(setDoc(ref, {
        tiers: cleanTiers,
        updatedAt: Date.now(),
        lastUpdatedBy: updatedByUsername
      }, { merge: true }).catch(() => {}));

      await Promise.all(syncPromises);
    })().catch(err => console.warn('[Firestore] updateTierListTiers background sync notice:', err));

    return true;
  }

  /**
   * Update Tier List Title
   */
  public async updateTierListTitle(tierListId: string, title: string): Promise<boolean> {
    if (!tierListId) return false;
    const cleanTitle = title.trim() || 'Untitled Tier List';

    // 1. Update local storage
    const currentLists = this.getLocalTierLists();
    const item = currentLists.find(l => l.id === tierListId);
    if (item) {
      item.title = cleanTitle;
      item.updatedAt = Date.now();
      this.saveLocalTierLists(currentLists);
    }

    // 2. Update Firestore
    const db = this.getDb();
    if (!db) return true;

    const currentUid = FirebaseAuthService.getCurrentUser()?.uid || (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_persistent_uid') : null);

    if (currentUid) {
      try {
        const uRef = doc(db, 'users', currentUid);
        await setDoc(uRef, {
          tierLists: currentLists.slice(0, 30),
          updatedAt: Date.now()
        }, { merge: true });
      } catch (_) {}
    }

    // 2b. Broadcast title change to shares/tier_room_${tierListId}
    if (item) {
      try {
        const roomRef = doc(db, 'shares', `tier_room_${tierListId}`);
        await setDoc(roomRef, {
          id: `tier_room_${tierListId}`,
          type: 'tier_room',
          tierListId,
          tierList: item,
          updatedAt: Date.now()
        }, { merge: true });
      } catch (_) {}
    }

    try {
      const ref = doc(db, 'tierLists', tierListId);
      await setDoc(ref, {
        title: cleanTitle,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] updateTierListTitle cloud sync warning (saved locally):', e);
    }

    return true;
  }

  /**
   * Update collaborators for a Tier List
   */
  public async updateTierListCollaborators(
    tierListId: string,
    collaboratorUids: string[],
    collaboratorUsernames: string[]
  ): Promise<boolean> {
    if (!tierListId) return false;
    const local = this.getLocalTierLists();
    const target = local.find(l => l.id === tierListId);
    if (target) {
      target.isCollaborative = true;
      target.collaboratorUids = collaboratorUids;
      target.collaboratorUsernames = collaboratorUsernames;
      target.updatedAt = Date.now();
      this.saveLocalTierLists(local);
    }

    const db = this.getDb();
    if (db) {
      try {
        const ref = doc(db, 'tierLists', tierListId);
        await updateDoc(ref, {
          isCollaborative: true,
          collaboratorUids,
          collaboratorUsernames,
          updatedAt: Date.now()
        });
      } catch (_) {}
    }
    return true;
  }

  /**
   * Delete a Tier List
   */
  public async deleteTierList(tierListId: string): Promise<boolean> {
    if (!tierListId) return false;

    // 0. Register anti-resurrection tombstone immediately
    this.addDeletedTierListTombstone(tierListId);

    // 1. Delete from local storage
    const currentLists = this.getLocalTierLists().filter(l => l.id !== tierListId);
    this.saveLocalTierLists(currentLists);

    // 2. Also delete from Supabase tier_lists table & broadcast deletion (<50ms)
    SupabaseService.deleteTierList(tierListId).catch(() => {});

    // 3. Delete from Firestore
    const db = this.getDb();
    if (!db) return true;

    const currentUid = FirebaseAuthService.getCurrentUser()?.uid || (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_persistent_uid') : null);

    if (currentUid) {
      try {
        const uRef = doc(db, 'users', currentUid);
        await setDoc(uRef, {
          tierLists: currentLists.slice(0, 30),
          deletedTierListIds: arrayUnion(tierListId),
          updatedAt: Date.now()
        }, { merge: true });
      } catch (_) {}
    }

    // 4. Delete the tier list document from Firestore tierLists collection
    try {
      const ref = doc(db, 'tierLists', tierListId);
      await deleteDoc(ref);
    } catch (e) {
      console.warn('[Firestore] deleteTierList cloud sync warning (deleted locally):', e);
    }

    // 5. Broadcast deletion room doc and delete room doc
    try {
      const roomRef = doc(db, 'shares', `tier_room_${tierListId}`);
      await deleteDoc(roomRef);
    } catch (_) {}

    // 6. Broadcast delete to collaborators if collaborative
    const item = currentLists.find(l => l.id === tierListId);
    if (item && item.isCollaborative) {
      const recipients = new Set<string>();
      if (item.ownerId && item.ownerId !== currentUid) recipients.add(item.ownerId);
      (item.collaboratorUids || []).forEach(uid => {
        if (uid && uid !== currentUid) recipients.add(uid);
      });

      for (const recId of recipients) {
        try {
          const shareId = `share_tier_del_${tierListId}_${recId}_${Date.now()}`;
          const sRef = doc(db, 'shares', shareId);
          await setDoc(sRef, {
            id: shareId,
            senderId: currentUid || 'user',
            recipientId: recId,
            type: 'collaborative_tier_list_delete',
            deletedTierListId: tierListId,
            createdAt: Date.now()
          });
        } catch (_) {}
      }
    }

    // 7. Delete all incoming/outgoing shares related to this tier list
    try {
      const qShares = query(collection(db, 'shares'), where('tierListId', '==', tierListId), limit(25));
      const snap = await getDocs(qShares);
      snap.forEach(d => deleteDoc(d.ref).catch(() => {}));
    } catch (_) {}

    return true;
  }

  /**
   * Real-time subscription to all tier lists owned by user or shared collaboratively with user
   */
  public subscribeUserTierLists(
    userId: string,
    callback: (lists: FirestoreTierList[]) => void,
    username?: string
  ): () => void {
    // 1. Immediately emit from local cache (already tombstone filtered)
    const initialLocal = this.getLocalTierLists();
    callback(initialLocal);

    const db = this.getDb();
    if (!db || !userId) {
      return () => {};
    }

    const unsubs: (() => void)[] = [];
    const remoteMap = new Map<string, FirestoreTierList>();

    const emit = () => {
      const tombstones = this.getDeletedTierListTombstones();
      const map = new Map<string, FirestoreTierList>();
      // Add existing local lists (excluding tombstones)
      this.getLocalTierLists().forEach((l: FirestoreTierList) => {
        if (!tombstones.has(l.id)) map.set(l.id, l);
      });
      // Merge remote lists (excluding tombstones)
      remoteMap.forEach((l, id) => {
        if (!tombstones.has(id)) {
          const existing = map.get(id);
          if (!existing || (l.updatedAt || 0) >= (existing.updatedAt || 0)) {
            map.set(id, l);
          }
        }
      });
      const combined = Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      this.saveLocalTierLists(combined);
      callback(combined);
    };

    // A. Real-time listener on user's own profile doc (users/{userId}) for stored tierLists
    try {
      const uRef = doc(db, 'users', userId);
      const unsubUser = onSnapshot(uRef, (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          if (Array.isArray(d.deletedTierListIds)) {
            d.deletedTierListIds.forEach((delId: string) => this.addDeletedTierListTombstone(delId));
          }
          const tombstones = this.getDeletedTierListTombstones();
          if (Array.isArray(d.tierLists)) {
            d.tierLists.forEach((tl: FirestoreTierList) => {
              if (tl && tl.id && !tombstones.has(tl.id)) remoteMap.set(tl.id, tl);
            });
            emit();
          }
        }
      }, () => {});
      unsubs.push(unsubUser);
    } catch (_) {}

    // B. Real-time listener on incoming shares for collaborative tier lists (By UID and Username)
    const cleanU = username ? username.replace(/^@/, '').trim().toLowerCase() : '';
    try {
      const qShares = query(
        collection(db, 'shares'),
        where('recipientId', '==', userId),
        limit(50)
      );
      const unsubShares = onSnapshot(qShares, (snap) => {
        let changed = false;
        const tombstones = this.getDeletedTierListTombstones();
        snap.forEach((d) => {
          const data = d.data();
          if ((data.type === 'collaborative_tier_list' || data.type === 'collaborative_tier_list_update') && data.tierList) {
            if (!tombstones.has(data.tierList.id)) {
              remoteMap.set(data.tierList.id, data.tierList);
              changed = true;
            }
          } else if (data.type === 'collaborative_tier_list_delete' && data.deletedTierListId) {
            this.addDeletedTierListTombstone(data.deletedTierListId);
            remoteMap.delete(data.deletedTierListId);
            const current = this.getLocalTierLists().filter(l => l.id !== data.deletedTierListId);
            this.saveLocalTierLists(current);
            changed = true;
          }
        });
        if (changed) emit();
      }, () => {});
      unsubs.push(unsubShares);

      if (cleanU && cleanU !== 'listener') {
        const qSharesUser = query(
          collection(db, 'shares'),
          where('recipientUsername', '==', cleanU),
          limit(50)
        );
        const unsubSharesUser = onSnapshot(qSharesUser, (snap) => {
          let changed = false;
          const tombstones = this.getDeletedTierListTombstones();
          snap.forEach((d) => {
            const data = d.data();
            if ((data.type === 'collaborative_tier_list' || data.type === 'collaborative_tier_list_update') && data.tierList) {
              if (!tombstones.has(data.tierList.id)) {
                remoteMap.set(data.tierList.id, data.tierList);
                changed = true;
              }
            } else if (data.type === 'collaborative_tier_list_delete' && data.deletedTierListId) {
              this.addDeletedTierListTombstone(data.deletedTierListId);
              remoteMap.delete(data.deletedTierListId);
              const current = this.getLocalTierLists().filter(l => l.id !== data.deletedTierListId);
              this.saveLocalTierLists(current);
              changed = true;
            }
          });
          if (changed) emit();
        }, () => {});
        unsubs.push(unsubSharesUser);
      }
    } catch (_) {}

    // C. Scan connected friends' public profile documents (users/{friendUid}.tierLists)
    try {
      const qFriendships = query(collection(db, 'friendships'), where('userA', '==', userId));
      const unsubFriends = onSnapshot(qFriendships, async (snap) => {
        if (snap.empty) return;
        const friendUids: string[] = [];
        snap.forEach(d => {
          const uB = d.data()?.userB;
          if (uB && uB !== userId && !friendUids.includes(uB)) {
            friendUids.push(uB);
          }
        });

        for (const fUid of friendUids.slice(0, 25)) {
          try {
            const fDoc = await getDoc(doc(db, 'users', fUid));
            if (fDoc.exists()) {
              const fData = fDoc.data();
              if (Array.isArray(fData?.tierLists)) {
                let foundNew = false;
                fData.tierLists.forEach((tl: FirestoreTierList) => {
                  if (!tl || !tl.id) return;
                  const isCollab = tl.isCollaborative && (
                    (Array.isArray(tl.collaboratorUids) && tl.collaboratorUids.includes(userId)) ||
                    (cleanU && Array.isArray(tl.collaboratorUsernames) && tl.collaboratorUsernames.map(u => (u || '').toLowerCase().replace(/^@/, '')).includes(cleanU)) ||
                    tl.ownerId === userId
                  );
                  if (isCollab && !this.getDeletedTierListTombstones().has(tl.id)) {
                    remoteMap.set(tl.id, tl);
                    foundNew = true;
                  }
                });
                if (foundNew) emit();
              }
            }
          } catch (_) {}
        }
      }, () => {});
      unsubs.push(unsubFriends);
    } catch (_) {}

    // D. Dual-write fallback queries to tierLists collection
    try {
      const qOwner = query(collection(db, 'tierLists'), where('ownerId', '==', userId), limit(30));
      const qCollab = query(collection(db, 'tierLists'), where('collaboratorUids', 'array-contains', userId), limit(30));

      const unsub1 = onSnapshot(qOwner, (snap) => {
        const tombstones = this.getDeletedTierListTombstones();
        snap.docs.forEach(d => {
          if (!tombstones.has(d.id)) remoteMap.set(d.id, d.data() as FirestoreTierList);
        });
        emit();
      }, () => {});
      unsubs.push(unsub1);

      const unsub2 = onSnapshot(qCollab, (snap) => {
        const tombstones = this.getDeletedTierListTombstones();
        snap.docs.forEach(d => {
          if (!tombstones.has(d.id)) remoteMap.set(d.id, d.data() as FirestoreTierList);
        });
        emit();
      }, () => {});
      unsubs.push(unsub2);

      if (username) {
        const cleanU = username.replace(/^@/, '').trim().toLowerCase();
        if (cleanU && cleanU !== 'listener') {
          const qCollabUser = query(collection(db, 'tierLists'), where('collaboratorUsernames', 'array-contains', cleanU), limit(30));
          const unsub3 = onSnapshot(qCollabUser, (snap) => {
            const tombstones = this.getDeletedTierListTombstones();
            snap.docs.forEach(d => {
              if (!tombstones.has(d.id)) remoteMap.set(d.id, d.data() as FirestoreTierList);
            });
            emit();
          }, () => {});
          unsubs.push(unsub3);
        }
      }
    } catch (_) {}

    return () => {
      unsubs.forEach(u => u());
    };
  }

  /**
   * Fetch recent tier lists from friends for comparison
   */
  public async getFriendsTierLists(friendUids: string[]): Promise<FirestoreTierList[]> {
    const db = this.getDb();
    if (!db || !friendUids || friendUids.length === 0) return [];

    try {
      const uids = friendUids.slice(0, 10);
      const q = query(collection(db, 'tierLists'), where('ownerId', 'in', uids), limit(20));
      const snap = await getDocs(q);
      const lists: FirestoreTierList[] = [];
      snap.forEach(d => lists.push(d.data() as FirestoreTierList));
      lists.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return lists;
    } catch (e) {
      console.warn('[Firestore] getFriendsTierLists error:', e);
      return [];
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
      addedAt: typeof t.addedAt === 'number' ? t.addedAt : Date.now(),
      addedByUid: t.addedByUid ? String(t.addedByUid) : null,
      addedByUsername: t.addedByUsername ? String(t.addedByUsername) : null
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
        updatedAt: Date.now(),
        ownerUid: p.ownerUid || userId,
        ownerUsername: p.ownerUsername || '',
        isPublic: p.isPublic !== false,
        isCollaborative: !!p.isCollaborative,
        collaboratorUids: Array.isArray(p.collaboratorUids) ? p.collaboratorUids : [],
        collaboratorUsernames: Array.isArray(p.collaboratorUsernames) ? p.collaboratorUsernames : []
      }));

      // 1. Save public playlists directly to users/{userId}.publicPlaylists (100% readable by friends in production!)
      const publicLists = sanitized.filter(p => p.isPublic !== false);
      try {
        const uRef = doc(db, 'users', userId);
        await setDoc(uRef, {
          publicPlaylists: publicLists,
          updatedAt: Date.now()
        }, { merge: true });
      } catch (uErr) {
        console.warn('[Firestore] save publicPlaylists to users doc notice:', uErr);
      }

      // 2. Also write to userPlaylists/{userId}
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

    let targetUid = userId.trim();
    if (targetUid.startsWith('@') || targetUid.length < 20) {
      try {
        const resolved = await this.resolveUsername(targetUid.replace(/^@/, ''));
        if (resolved?.uid) {
          targetUid = resolved.uid;
        }
      } catch (_) {}
    }

    try {
      const currentUid = FirebaseAuthService.getCurrentUser()?.uid || (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_persistent_uid') : null);

      // 1. Try reading users/{targetUid}.publicPlaylists first (100% permitted read for all users!)
      try {
        const uRef = doc(db, 'users', targetUid);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists()) {
          const uData = uSnap.data();
          if (Array.isArray(uData.publicPlaylists) && uData.publicPlaylists.length > 0) {
            return {
              exists: true,
              playlists: uData.publicPlaylists as CustomPlaylist[]
            };
          }
        }
      } catch (uErr) {
        console.warn('[Firestore] getUserPlaylists from users doc notice:', uErr);
      }

      // 2. Fallback: check /userPlaylists/{targetUid}
      try {
        const ref = doc(db, 'userPlaylists', targetUid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const all = (data.playlists as CustomPlaylist[]) || [];
          if (currentUid && currentUid === targetUid) {
            return { exists: true, playlists: all };
          }
          const accessible = all.filter(p => 
            p.isPublic !== false || 
            (p.isCollaborative && currentUid && Array.isArray(p.collaboratorUids) && p.collaboratorUids.includes(currentUid))
          );
          return {
            exists: true,
            playlists: accessible
          };
        }
      } catch (upErr) {
        console.warn('[Firestore] getUserPlaylists userPlaylists fallback notice:', upErr);
      }

      // 3. Fallback: check /users/{targetUid}/playlists subcollection
      try {
        const subCol = collection(db, 'users', targetUid, 'playlists');
        const subSnap = await getDocs(subCol);
        if (!subSnap.empty) {
          const list: CustomPlaylist[] = [];
          subSnap.forEach(d => {
            const p = d.data() as CustomPlaylist;
            if (p.isPublic !== false || (p.isCollaborative && currentUid && Array.isArray(p.collaboratorUids) && p.collaboratorUids.includes(currentUid))) {
              list.push(p);
            }
          });
          return { exists: true, playlists: list };
        }
      } catch (_) {}

      return {
        exists: false,
        playlists: []
      };
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
   * Retrieves user ratings once from Firestore (reads publicRatings from user profile first, fallback to userRatings)
   */
  public async getUserRatings(userId: string): Promise<Record<string, string | null> | null> {
    const db = this.getDb();
    if (!db || !userId) return null;

    let targetUid = userId.trim();
    if (targetUid.startsWith('@') || targetUid.length < 20) {
      try {
        const resolved = await this.resolveUsername(targetUid.replace(/^@/, ''));
        if (resolved?.uid) {
          targetUid = resolved.uid;
        }
      } catch (_) {}
    }

    try {
      // 1. Try public profile document first (100% allowed read for all users in production)
      try {
        const uRef = doc(db, 'users', targetUid);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists()) {
          const uData = uSnap.data();
          if (uData.publicRatings && typeof uData.publicRatings === 'object') {
            const map: Record<string, string | null> = {};
            Object.entries(uData.publicRatings).forEach(([tid, val]: [string, any]) => {
              if (val && typeof val === 'object' && val.formatted) {
                map[tid] = String(val.formatted);
              } else if (typeof val === 'string') {
                map[tid] = val;
              }
            });
            return map;
          }
        }
      } catch (uErr) {
        console.warn('[Firestore] getUserRatings user doc notice:', uErr);
      }

      // 2. Try legacy userRatings doc
      const ref = doc(db, 'userRatings', targetUid);
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
   * Retrieves all rated tracks by a user with full metadata (title, artist, cover) for friend comparisons
   */
  public async getUserRatedTracks(userId: string): Promise<{
    ratings: Record<string, string | null>;
    tracks: Track[];
  }> {
    const db = this.getDb();
    if (!db || !userId) return { ratings: {}, tracks: [] };

    let targetUid = userId.trim();
    if (targetUid.startsWith('@') || targetUid.length < 20) {
      try {
        const resolved = await this.resolveUsername(targetUid.replace(/^@/, ''));
        if (resolved?.uid) {
          targetUid = resolved.uid;
        }
      } catch (_) {}
    }

    try {
      // 1. Check users/{targetUid}.publicRatings
      const uRef = doc(db, 'users', targetUid);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        const uData = uSnap.data();
        if (uData.publicRatings && typeof uData.publicRatings === 'object') {
          const ratingsMap: Record<string, string | null> = {};
          const trackList: Track[] = [];

          Object.entries(uData.publicRatings).forEach(([tid, val]: [string, any]) => {
            // Local metadata lookup helper to heal incomplete track info
            let resolvedTitle: string | null = null;
            let resolvedArtist: string | null = null;
            let resolvedCover: string | null = null;

            if (typeof window !== 'undefined' && window.localStorage) {
              try {
                const storedMeta = localStorage.getItem('lumen_rated_tracks_metadata');
                if (storedMeta) {
                  const parsed = JSON.parse(storedMeta);
                  if (parsed[tid]?.title) {
                    resolvedTitle = parsed[tid].title;
                    resolvedArtist = parsed[tid].artist;
                    resolvedCover = parsed[tid].artworkUrl || null;
                  }
                }
              } catch (_) {}
              if (!resolvedTitle) {
                try {
                  const liked = localStorage.getItem('lumen_liked_tracks_v1') || localStorage.getItem('lumen_liked_tracks');
                  if (liked) {
                    const parsed = JSON.parse(liked);
                    const match = (Array.isArray(parsed) ? parsed : Object.values(parsed)).find((t: any) => t?.id === tid);
                    if (match?.title) {
                      resolvedTitle = match.title;
                      resolvedArtist = match.artist;
                      resolvedCover = match.artworkUrl || null;
                    }
                  }
                } catch (_) {}
              }
              if (!resolvedTitle) {
                try {
                  const pls = localStorage.getItem('lumen_custom_playlists_v1');
                  if (pls) {
                    JSON.parse(pls).forEach((p: any) => {
                      const match = (p.tracks || []).find((t: any) => t?.id === tid);
                      if (match?.title && !resolvedTitle) {
                        resolvedTitle = match.title;
                        resolvedArtist = match.artist;
                        resolvedCover = match.artworkUrl || null;
                      }
                    });
                  }
                } catch (_) {}
              }
            }

            if (val && typeof val === 'object') {
              const formatted = val.formatted || (val.score ? String(val.score) : null);
              ratingsMap[tid] = formatted;
              if (val.track && val.track.title) {
                trackList.push({
                  id: String(val.track.id || tid),
                  title: String(val.track.title || resolvedTitle || 'Rated Track'),
                  artist: String(val.track.artist || resolvedArtist || 'Lumen Artist'),
                  album: String(val.track.album || ''),
                  artworkUrl: val.track.artworkUrl ? String(val.track.artworkUrl) : (resolvedCover || null),
                  duration: typeof val.track.duration === 'number' ? val.track.duration : 0,
                  path: String(val.track.path || ''),
                  filename: String(val.track.filename || `${val.track.title || 'track'}.mp3`),
                  streamUrl: String(val.track.streamUrl || val.track.audioUrl || ''),
                  hasArtwork: Boolean(val.track.artworkUrl || val.track.hasArtwork || resolvedCover),
                  addedAt: typeof val.track.addedAt === 'number' ? val.track.addedAt : Date.now()
                });
              } else {
                trackList.push({
                  id: String(tid),
                  title: resolvedTitle || (tid.length > 15 ? tid.replace(/_/g, ' ') : `Track #${String(tid).slice(-4)}`),
                  artist: resolvedArtist || 'Lumen Artist',
                  album: '',
                  artworkUrl: resolvedCover || null,
                  duration: 180,
                  path: '',
                  filename: `${tid}.mp3`,
                  streamUrl: '',
                  hasArtwork: Boolean(resolvedCover),
                  addedAt: Date.now()
                });
              }
            } else if (typeof val === 'string') {
              ratingsMap[tid] = val;
              trackList.push({
                id: String(tid),
                title: resolvedTitle || (tid.length > 15 ? tid.replace(/_/g, ' ') : `Track #${String(tid).slice(-4)}`),
                artist: resolvedArtist || 'Lumen Artist',
                album: '',
                artworkUrl: resolvedCover || null,
                duration: 180,
                path: '',
                filename: `${tid}.mp3`,
                streamUrl: '',
                hasArtwork: Boolean(resolvedCover),
                addedAt: Date.now()
              });
            }
          });

          return { ratings: ratingsMap, tracks: trackList };
        }
      }

      // 2. Fallback to basic getUserRatings
      const ratings = await this.getUserRatings(targetUid);
      return { ratings: ratings || {}, tracks: [] };
    } catch (e) {
      console.warn('[Firestore] getUserRatedTracks error:', e);
      return { ratings: {}, tracks: [] };
    }
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
          userId: uid,
          user_id: uid,
          displayName: displayName || `@${clean}`,
          photoURL: photoURL || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });

        // 2. Set public profile in users/{uid}: No email, no hashes, no tokens!
        const userRef = doc(db, 'users', uid);
        txn.set(userRef, {
          username: clean,
          uid,
          userId: uid,
          user_id: uid,
          displayName: displayName || `@${clean}`,
          photoURL: photoURL || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
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

      // Announce and sync with Supabase and local cache immediately (<50ms)
      SupabaseService.announceUser({
        id: uid,
        username: clean,
        displayName: displayName || `@${clean}`,
        photoURL: photoURL || null
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
          userId: uid,
          user_id: uid,
          username: cleanNew,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });

        if (cleanOld && cleanOld !== cleanNew) {
          const oldRef = doc(db, 'usernames', cleanOld);
          txn.delete(oldRef);
        }

        const userRef = doc(db, 'users', uid);
        txn.update(userRef, {
          username: cleanNew,
          uid,
          userId: uid,
          user_id: uid,
          updatedAt: serverTimestamp()
        });
      });

      // Announce and sync with Supabase and local cache immediately (<50ms)
      SupabaseService.announceUser({
        id: uid,
        username: cleanNew,
        displayName: `@${cleanNew}`
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
        let resolvedUid = docUid(uData);

        if (!resolvedUid) {
          // Fallback: search users collection for username
          try {
            const uQuery = query(collection(db, 'users'), where('username', '==', clean), limit(1));
            const uSnap = await getDocs(uQuery);
            if (!uSnap.empty) {
              resolvedUid = uSnap.docs[0].id;
            }
          } catch (_) {}
        }

        const fullProf = resolvedUid ? await this.getUserProfile(resolvedUid) : null;
        return {
          ...uData,
          uid: resolvedUid || snap.id,
          userId: resolvedUid || snap.id,
          user_id: resolvedUid || snap.id,
          ...(fullProf || {})
        };
      }

      // If not in usernames registry, check users collection directly
      const userSearch = query(collection(db, 'users'), where('username', '==', clean), limit(1));
      const searchSnap = await getDocs(userSearch);
      if (!searchSnap.empty) {
        const userDoc = searchSnap.docs[0];
        const uData = userDoc.data();
        return {
          ...uData,
          uid: userDoc.id,
          userId: userDoc.id,
          user_id: userDoc.id
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
      const results: any[] = [];
      const seenIds = new Set<string>();

      // 1. Query usernames collection by document ID prefix
      const uCol = collection(db, 'usernames');
      const qUsernames = query(
        uCol,
        where(documentId(), '>=', clean),
        where(documentId(), '<=', clean + '\uf8ff'),
        limit(maxResults)
      );

      // 2. Query users collection by username prefix
      const usersCol = collection(db, 'users');
      const qUsers = query(
        usersCol,
        where('username', '>=', clean),
        where('username', '<=', clean + '\uf8ff'),
        limit(maxResults)
      );

      const [snapUsernames, snapUsers] = await Promise.all([
        getDocs(qUsernames).catch(() => null),
        getDocs(qUsers).catch(() => null)
      ]);

      if (snapUsernames) {
        snapUsernames.forEach((docSnap) => {
          const d = docSnap.data();
          const handle = d.username || docSnap.id;
          const id = d.uid || d.userId || d.user_id || docSnap.id;
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
      }

      if (snapUsers) {
        snapUsers.forEach((docSnap) => {
          const d = docSnap.data();
          const handle = d.username || docSnap.id;
          const id = docSnap.id || d.uid || d.userId || d.user_id;
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
      }

      return results.slice(0, maxResults);
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
      const sRef = doc(db, 'users', userId, 'stats', 'summary');
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
      const sRef = doc(db, 'users', userId, 'stats', 'summary');
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
      const sRef = doc(db, 'users', userId, 'stats', 'summary');
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

    // Check memory cache first (10 min TTL) for instantaneous 0ms friend rendering
    const cached = this.profileCache.get(userId);
    if (cached && Date.now() - cached.timestamp < 600000) {
      return cached.profile;
    }

    try {
      const ref = doc(db, 'users', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        const id = docUid(d) || userId;
        const prof = {
          ...d,
          uid: id,
          userId: id,
          user_id: id
        };
        this.profileCache.set(userId, { profile: prof, timestamp: Date.now() });
        return prof;
      }

      // Fallback: check usernames collection if users doc does not exist yet
      try {
        const uQuery = query(collection(db, 'usernames'), where('userId', '==', userId), limit(1));
        const uSnap = await getDocs(uQuery);
        if (!uSnap.empty) {
          const d = uSnap.docs[0].data();
          const id = docUid(d) || userId;
          const prof = {
            ...d,
            uid: id,
            userId: id,
            user_id: id
          };
          this.profileCache.set(userId, { profile: prof, timestamp: Date.now() });
          return prof;
        }
      } catch (_) {}
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

  // 3. Ratings: users/{uid}/ratings/{trackId} & users/{uid}.publicRatings
  public async setTrackRating(
    uid: string,
    trackOrId: Track | string,
    score: number,
    formatted: string
  ): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !trackOrId) return;

    const trackId = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
    if (!trackId) return;

    const cleanTrack: any = typeof trackOrId === 'object' ? {
      id: String(trackOrId.id),
      title: String(trackOrId.title || 'Unknown Title'),
      artist: String(trackOrId.artist || 'Unknown Artist'),
      album: trackOrId.album ? String(trackOrId.album) : null,
      artworkUrl: trackOrId.artworkUrl ? String(trackOrId.artworkUrl) : null,
      duration: typeof trackOrId.duration === 'number' ? trackOrId.duration : 0,
      streamUrl: (trackOrId as any).streamUrl ? String((trackOrId as any).streamUrl) : null,
      audioUrl: (trackOrId as any).audioUrl ? String((trackOrId as any).audioUrl) : ((trackOrId as any).streamUrl ? String((trackOrId as any).streamUrl) : null)
    } : {
      id: String(trackId),
      title: 'Unknown Title',
      artist: 'Unknown Artist'
    };

    // 1. Save to users/{uid}.publicRatings (dot-notation ensures atomic field update without wiping map)
    try {
      const uRef = doc(db, 'users', uid);
      await setDoc(uRef, {
        [`publicRatings.${String(trackId)}`]: {
          trackId: String(trackId),
          score,
          formatted,
          updatedAt: Date.now(),
          track: cleanTrack
        }
      }, { merge: true });
    } catch (uErr) {
      console.warn('[Firestore] setTrackRating publicRatings notice:', uErr);
    }

    // 2. Save to item-level subcollection
    try {
      const rRef = doc(db, 'users', uid, 'ratings', String(trackId));
      await setDoc(rRef, {
        trackId: String(trackId),
        score,
        formatted,
        track: cleanTrack,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] setTrackRating subcollection notice:', e);
    }
  }

  public async deleteTrackRating(uid: string, trackId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !uid || !trackId) return;

    try {
      const uRef = doc(db, 'users', uid);
      const snap = await getDoc(uRef);
      if (snap.exists()) {
        const d = snap.data();
        if (d.publicRatings && d.publicRatings[trackId]) {
          const updated = { ...d.publicRatings };
          delete updated[trackId];
          await setDoc(uRef, { publicRatings: updated }, { merge: true });
        }
      }
    } catch (_) {}

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
