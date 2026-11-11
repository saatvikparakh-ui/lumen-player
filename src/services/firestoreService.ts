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
import { getAuth } from 'firebase/auth';
import { FirebaseAuthService, AppUser } from './firebaseAuthService';
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
  type?: 'song' | 'playlist';
  song?: Track;
  playlist?: CustomPlaylist;
  message?: string;
  read: boolean;
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
        const id = docUid(data) || d.id;
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

    if (fromUser.isGuest || fromUser.uid.startsWith('usr_')) {
      return { success: false, error: 'Guest accounts cannot send cloud friend requests. Please sign in with Email or Google.' };
    }

    // Verify active non-anonymous Firebase Auth session (required by Firestore security rules)
    const fbAuthUser = getAuth(db.app).currentUser;
    if (!fbAuthUser || fbAuthUser.isAnonymous) {
      return { success: false, error: 'Cloud authentication session expired or guest-only. Please sign in with Email or Google.' };
    }
    const senderUid = fbAuthUser.uid;

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

      await setDoc(reqRef, payload);
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
    if (!fromUser || !fromUser.uid) return { success: false, error: 'Please sign in to share songs' };

    try {
      let targetUid = recipientUid;
      if (targetUid && (targetUid.startsWith('@') || targetUid.length < 20)) {
        const resolved = await this.resolveUsername(targetUid.replace(/^@/, ''));
        if (resolved?.uid) {
          targetUid = resolved.uid;
        }
      }

      if (!targetUid) {
        return { success: false, error: 'Recipient listener could not be found' };
      }

      const shareId = `share_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const shareRef = doc(db, 'shares', shareId);

      const senderHandle = (fromUser as any).username || 
        (fromUser.displayName && !fromUser.displayName.includes('@') ? fromUser.displayName : '') || 
        fromUser.email?.split('@')[0] || 'listener';

      const safeDuration = Number.isFinite(Number(track.duration)) ? Number(track.duration) : 0;

      await setDoc(shareRef, {
        id: shareId,
        senderId: fromUser.uid,
        senderUsername: senderHandle,
        senderDisplayName: fromUser.displayName || `@${senderHandle}`,
        recipientId: targetUid,
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
      });

      return { success: true };
    } catch (e: any) {
      console.error('[Firestore] sendSongShare error:', e);
      return { success: false, error: e.message || 'Failed to share song' };
    }
  }

  /**
   * Share an entire playlist with a friend in real time
   */
  public async sendPlaylistShare(
    fromUser: AppUser,
    recipientUid: string,
    playlist: CustomPlaylist,
    message?: string
  ): Promise<{ success: boolean; error?: string }> {
    const db = this.getDb();
    if (!db) return { success: false, error: 'Database unavailable' };
    if (!fromUser || !fromUser.uid) return { success: false, error: 'Please sign in to share playlists' };

    try {
      let targetUid = recipientUid;
      if (targetUid && (targetUid.startsWith('@') || targetUid.length < 20)) {
        const resolved = await this.resolveUsername(targetUid.replace(/^@/, ''));
        if (resolved?.uid) {
          targetUid = resolved.uid;
        }
      }

      if (!targetUid) {
        return { success: false, error: 'Recipient listener could not be found' };
      }

      const shareId = `share_pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const shareRef = doc(db, 'shares', shareId);

      const senderHandle = (fromUser as any).username || 
        (fromUser.displayName && !fromUser.displayName.includes('@') ? fromUser.displayName : '') || 
        fromUser.email?.split('@')[0] || 'listener';

      const safeTracks = (playlist.tracks || []).slice(0, 100).map(t => this.sanitizeTrack(t));

      await setDoc(shareRef, {
        id: shareId,
        senderId: fromUser.uid,
        senderUsername: senderHandle,
        senderDisplayName: fromUser.displayName || `@${senderHandle}`,
        recipientId: targetUid,
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
      });

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
          let dismissedSet = new Set<string>();
          try {
            const dismissedRaw = localStorage.getItem('lumen_dismissed_shares') || '[]';
            dismissedSet = new Set(JSON.parse(dismissedRaw));
          } catch (_) {}

          const list: FirestoreSongShare[] = [];
          snap.forEach(d => {
            const data = d.data() as FirestoreSongShare;
            if (data?.id && !dismissedSet.has(data.id)) {
              list.push(data);
            }
          });
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
  // Local Tier List Storage Caching Helpers
  // -------------------------------------------------------------
  public getLocalTierLists(): FirestoreTierList[] {
    try {
      const raw = localStorage.getItem('lumen_tier_lists');
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  public saveLocalTierLists(lists: FirestoreTierList[]): void {
    try {
      localStorage.setItem('lumen_tier_lists', JSON.stringify(lists));
    } catch (_) {}
  }

  public upsertLocalTierList(item: FirestoreTierList): void {
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

    // 2. Sync to Cloud Firestore
    const db = this.getDb();
    if (db) {
      // 2a. Save to users/{effectiveUid}.tierLists (100% permitted in production!)
      try {
        const currentLists = this.getLocalTierLists();
        const uRef = doc(db, 'users', effectiveUid);
        await setDoc(uRef, {
          tierLists: currentLists.slice(0, 30),
          updatedAt: Date.now()
        }, { merge: true });
      } catch (uErr) {
        console.warn('[Firestore] createTierList user doc sync notice:', uErr);
      }

      // 2b. Broadcast to collaborators via shares collection in real time
      if (isCollaborative && cleanCollabUids.length > 0) {
        for (const collabUid of cleanCollabUids) {
          if (!collabUid || collabUid === effectiveUid) continue;
          try {
            const shareId = `share_tier_${listId}_${collabUid}`;
            const sRef = doc(db, 'shares', shareId);
            await setDoc(sRef, {
              id: shareId,
              senderId: effectiveUid,
              senderUsername: senderHandle,
              senderDisplayName: fromUser?.displayName || `@${senderHandle}`,
              recipientId: collabUid,
              type: 'collaborative_tier_list',
              tierList: tierListData,
              createdAt: Date.now()
            });
          } catch (shErr) {
            console.warn('[Firestore] broadcast collaborative tier list share notice:', shErr);
          }
        }
      }

      // 2c. Write to /tierLists/{listId}
      try {
        const ref = doc(db, 'tierLists', listId);
        await setDoc(ref, tierListData);
      } catch (e: any) {
        console.warn('[Firestore] createTierList cloud sync warning (safely stored locally):', e);
      }
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

    // 2. Direct tierLists collection listener (if cloud permissions allow)
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

    // 3. Real-time shares stream for live collaborative updates
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

    // 2. Update Firestore
    const db = this.getDb();
    if (!db) return true;

    const currentUid = FirebaseAuthService.getCurrentUser()?.uid || (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_persistent_uid') : null);

    // 2a. Update users/{currentUid}.tierLists
    if (currentUid) {
      try {
        const uRef = doc(db, 'users', currentUid);
        await setDoc(uRef, {
          tierLists: currentLists.slice(0, 30),
          updatedAt: Date.now()
        }, { merge: true });
      } catch (_) {}
    }

    // 2b. If collaborative, broadcast update to owner and other collaborators via shares
    if (item && item.isCollaborative) {
      const recipients = new Set<string>();
      if (item.ownerId && item.ownerId !== currentUid) {
        recipients.add(item.ownerId);
      }
      (item.collaboratorUids || []).forEach(uid => {
        if (uid && uid !== currentUid) recipients.add(uid);
      });

      for (const recId of recipients) {
        try {
          const shareId = `share_tier_up_${tierListId}_${recId}_${Date.now()}`;
          const sRef = doc(db, 'shares', shareId);
          await setDoc(sRef, {
            id: shareId,
            senderId: currentUid || 'collaborator',
            senderUsername: updatedByUsername,
            recipientId: recId,
            type: 'collaborative_tier_list_update',
            tierList: item,
            createdAt: Date.now()
          });
        } catch (_) {}
      }
    }

    // 2c. Update /tierLists/{tierListId}
    try {
      const ref = doc(db, 'tierLists', tierListId);
      await setDoc(ref, {
        tiers: cleanTiers,
        updatedAt: Date.now(),
        lastUpdatedBy: updatedByUsername
      }, { merge: true });
    } catch (e) {
      console.warn('[Firestore] updateTierListTiers cloud sync warning (saved locally):', e);
    }

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
   * Delete a Tier List
   */
  public async deleteTierList(tierListId: string): Promise<boolean> {
    if (!tierListId) return false;

    // 1. Delete from local storage
    const currentLists = this.getLocalTierLists();
    const item = currentLists.find(l => l.id === tierListId);
    this.saveLocalTierLists(currentLists.filter(l => l.id !== tierListId));

    // 2. Delete from Firestore
    const db = this.getDb();
    if (!db) return true;

    const currentUid = FirebaseAuthService.getCurrentUser()?.uid || (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_persistent_uid') : null);

    if (currentUid) {
      try {
        const uRef = doc(db, 'users', currentUid);
        await setDoc(uRef, {
          tierLists: currentLists.filter(l => l.id !== tierListId).slice(0, 30),
          updatedAt: Date.now()
        }, { merge: true });
      } catch (_) {}
    }

    // If collaborative, broadcast delete event to collaborators
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

    try {
      const ref = doc(db, 'tierLists', tierListId);
      await deleteDoc(ref);
    } catch (e) {
      console.warn('[Firestore] deleteTierList cloud sync warning (deleted locally):', e);
    }

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
    // 1. Immediately emit from local cache
    const initialLocal = this.getLocalTierLists();
    callback(initialLocal);

    const db = this.getDb();
    if (!db || !userId) {
      return () => {};
    }

    const unsubs: (() => void)[] = [];
    const remoteMap = new Map<string, FirestoreTierList>();

    const emit = () => {
      const map = new Map<string, FirestoreTierList>();
      // Add existing local lists
      this.getLocalTierLists().forEach((l: FirestoreTierList) => map.set(l.id, l));
      // Merge remote lists
      remoteMap.forEach((l, id) => {
        const existing = map.get(id);
        if (!existing || (l.updatedAt || 0) >= (existing.updatedAt || 0)) {
          map.set(id, l);
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
          if (Array.isArray(d.tierLists)) {
            d.tierLists.forEach((tl: FirestoreTierList) => {
              if (tl && tl.id) remoteMap.set(tl.id, tl);
            });
            emit();
          }
        }
      }, () => {});
      unsubs.push(unsubUser);
    } catch (_) {}

    // B. Real-time listener on incoming shares for collaborative tier lists
    try {
      const qShares = query(
        collection(db, 'shares'),
        where('recipientId', '==', userId),
        limit(50)
      );
      const unsubShares = onSnapshot(qShares, (snap) => {
        let changed = false;
        snap.forEach((d) => {
          const data = d.data();
          if ((data.type === 'collaborative_tier_list' || data.type === 'collaborative_tier_list_update') && data.tierList) {
            remoteMap.set(data.tierList.id, data.tierList);
            changed = true;
          } else if (data.type === 'collaborative_tier_list_delete' && data.deletedTierListId) {
            remoteMap.delete(data.deletedTierListId);
            const current = this.getLocalTierLists().filter(l => l.id !== data.deletedTierListId);
            this.saveLocalTierLists(current);
            changed = true;
          }
        });
        if (changed) emit();
      }, () => {});
      unsubs.push(unsubShares);
    } catch (_) {}

    // C. Dual-write fallback queries to tierLists collection
    try {
      const qOwner = query(collection(db, 'tierLists'), where('ownerId', '==', userId), limit(30));
      const qCollab = query(collection(db, 'tierLists'), where('collaboratorUids', 'array-contains', userId), limit(30));

      const unsub1 = onSnapshot(qOwner, (snap) => {
        snap.docs.forEach(d => remoteMap.set(d.id, d.data() as FirestoreTierList));
        emit();
      }, () => {});
      unsubs.push(unsub1);

      const unsub2 = onSnapshot(qCollab, (snap) => {
        snap.docs.forEach(d => remoteMap.set(d.id, d.data() as FirestoreTierList));
        emit();
      }, () => {});
      unsubs.push(unsub2);

      if (username) {
        const cleanU = username.replace(/^@/, '').trim().toLowerCase();
        if (cleanU && cleanU !== 'listener') {
          const qCollabUser = query(collection(db, 'tierLists'), where('collaboratorUsernames', 'array-contains', cleanU), limit(30));
          const unsub3 = onSnapshot(qCollabUser, (snap) => {
            snap.docs.forEach(d => remoteMap.set(d.id, d.data() as FirestoreTierList));
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

    try {
      const currentUid = FirebaseAuthService.getCurrentUser()?.uid || (typeof localStorage !== 'undefined' ? localStorage.getItem('lumen_persistent_uid') : null);

      // 1. Try reading users/{userId}.publicPlaylists first (100% permitted read for all users!)
      try {
        const uRef = doc(db, 'users', userId);
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

      // 2. Fallback: check /userPlaylists/{userId}
      try {
        const ref = doc(db, 'userPlaylists', userId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const all = (data.playlists as CustomPlaylist[]) || [];
          if (currentUid && currentUid === userId) {
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

      // 3. Fallback: check /users/{userId}/playlists subcollection
      try {
        const subCol = collection(db, 'users', userId, 'playlists');
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

    try {
      // 1. Try public profile document first (100% allowed read for all users in production)
      try {
        const uRef = doc(db, 'users', userId);
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
   * Retrieves all rated tracks by a user with full metadata (title, artist, cover) for friend comparisons
   */
  public async getUserRatedTracks(userId: string): Promise<{
    ratings: Record<string, string | null>;
    tracks: Track[];
  }> {
    const db = this.getDb();
    if (!db || !userId) return { ratings: {}, tracks: [] };

    try {
      // 1. Check users/{userId}.publicRatings
      const uRef = doc(db, 'users', userId);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        const uData = uSnap.data();
        if (uData.publicRatings && typeof uData.publicRatings === 'object') {
          const ratingsMap: Record<string, string | null> = {};
          const trackList: Track[] = [];

          Object.entries(uData.publicRatings).forEach(([tid, val]: [string, any]) => {
            if (val && typeof val === 'object') {
              const formatted = val.formatted || (val.score ? String(val.score) : null);
              ratingsMap[tid] = formatted;
              if (val.track && val.track.title) {
                trackList.push({
                  id: String(val.track.id || tid),
                  title: String(val.track.title || 'Unknown Title'),
                  artist: String(val.track.artist || 'Unknown Artist'),
                  album: String(val.track.album || ''),
                  artworkUrl: val.track.artworkUrl ? String(val.track.artworkUrl) : null,
                  duration: typeof val.track.duration === 'number' ? val.track.duration : 0,
                  path: String(val.track.path || ''),
                  filename: String(val.track.filename || `${val.track.title || 'track'}.mp3`),
                  streamUrl: String(val.track.streamUrl || val.track.audioUrl || ''),
                  hasArtwork: Boolean(val.track.artworkUrl || val.track.hasArtwork),
                  addedAt: typeof val.track.addedAt === 'number' ? val.track.addedAt : Date.now()
                });
              }
            } else if (typeof val === 'string') {
              ratingsMap[tid] = val;
            }
          });

          return { ratings: ratingsMap, tracks: trackList };
        }
      }

      // 2. Fallback to basic getUserRatings
      const ratings = await this.getUserRatings(userId);
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

    try {
      const ref = doc(db, 'users', userId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d = snap.data();
        const id = docUid(d) || userId;
        return {
          ...d,
          uid: id,
          userId: id,
          user_id: id
        };
      }

      // Fallback: check usernames collection if users doc does not exist yet
      try {
        const uQuery = query(collection(db, 'usernames'), where('userId', '==', userId), limit(1));
        const uSnap = await getDocs(uQuery);
        if (!uSnap.empty) {
          const d = uSnap.docs[0].data();
          const id = docUid(d) || userId;
          return {
            ...d,
            uid: id,
            userId: id,
            user_id: id
          };
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

    // 1. Save to users/{uid}.publicRatings (100% permitted read for all friends in production!)
    try {
      const uRef = doc(db, 'users', uid);
      await setDoc(uRef, {
        publicRatings: {
          [String(trackId)]: {
            trackId: String(trackId),
            score,
            formatted,
            updatedAt: Date.now(),
            track: cleanTrack
          }
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
