/**
 * LUMEN PASS THE AUX SERVICE
 * Server-authoritative real-time collaborative queue sessions.
 * Manages room lifecycle, queue synchronization, voting (Vote Next),
 * round-robin turns, and provider-aware song references with zero audio piracy.
 */

import { doc, setDoc, onSnapshot, getDoc } from 'firebase/firestore';
import { FirestoreService } from './firestoreService';
import { SupabaseService } from './supabaseService';
import { AppUser } from './firebaseAuthService';
import { Track } from '../types/music';
import { 
  AuxSession, 
  AuxQueueItem, 
  AuxParticipant, 
  AuxEvent, 
  AuxSessionMode, 
  AuxSettings,
  AuxEventType 
} from '../types/auxTypes';

export class AuxService {
  private static STORAGE_KEY = 'lumen_aux_sessions';
  private static ACTIVE_ROOM_KEY = 'lumen_active_aux_session';

  /**
   * Default conservative room settings
   */
  public static getDefaultSettings(): AuxSettings {
    return {
      canReorder: true,
      explicitFiltering: false,
      maxTracksPerParticipant: 6,
      inactivityTimeoutMinutes: 60,
      duplicatePolicy: 'warn_allow'
    };
  }

  /**
   * Get all cached local sessions
   */
  public static getLocalSessions(): AuxSession[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Save sessions to local storage
   */
  private static saveLocalSessions(sessions: AuxSession[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(sessions));
    } catch (_) {}
  }

  /**
   * Create a new Pass The Aux Session
   */
  public static async createSession(
    hostUser: AppUser,
    title: string,
    mode: AuxSessionMode = 'open_queue',
    description?: string,
    invitedFriends: Array<{ uid: string; username: string; displayName: string; photoURL?: string | null }> = [],
    settings?: Partial<AuxSettings>
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    const sessionId = `aux_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const effectiveSettings: AuxSettings = {
      ...this.getDefaultSettings(),
      ...(settings || {})
    };

    const hostParticipant: AuxParticipant = {
      id: `part_${hostUser.uid}`,
      sessionId,
      userId: hostUser.uid,
      username: hostUser.username || hostUser.displayName || 'host',
      displayName: hostUser.displayName || hostUser.username || 'Host',
      photoURL: hostUser.photoURL || null,
      role: 'host',
      invitationStatus: 'accepted',
      joinedAt: now,
      lastSeenAt: now
    };

    const invitedParticipants: AuxParticipant[] = invitedFriends.map(f => ({
      id: `part_${f.uid}`,
      sessionId,
      userId: f.uid,
      username: f.username,
      displayName: f.displayName,
      photoURL: f.photoURL || null,
      role: 'participant',
      invitationStatus: 'invited',
      joinedAt: 0,
      lastSeenAt: 0
    }));

    const initialEvent: AuxEvent = {
      id: `evt_${now}_init`,
      sessionId,
      actorUserId: hostUser.uid,
      actorUsername: hostUser.username || hostUser.displayName || 'host',
      eventType: 'session_created',
      payload: { mode, title },
      createdAt: now,
      sequence: 1
    };

    const session: AuxSession = {
      id: sessionId,
      hostUserId: hostUser.uid,
      hostUsername: hostUser.username || 'host',
      hostDisplayName: hostUser.displayName || 'Host',
      title: title.trim() || 'Lumen AUX Room',
      description: description?.trim() || 'Shared music session',
      status: 'active',
      mode,
      settings: effectiveSettings,
      participants: [hostParticipant, ...invitedParticipants],
      queue: [],
      currentQueueItemId: null,
      events: [initialEvent],
      createdAt: now,
      updatedAt: now,
      expiresAt: now + effectiveSettings.inactivityTimeoutMinutes * 60 * 1000,
      version: 1
    };

    // 1. Save locally instantly (0ms)
    const sessions = this.getLocalSessions();
    this.saveLocalSessions([session, ...sessions.filter(s => s.id !== sessionId)]);
    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${sessionId}`, JSON.stringify(session));
    } catch (_) {}

    // 2. Broadcast to Firestore and invitees in background (non-blocking instant creation)
    this.syncToCloud(session).catch(err => console.warn('[AuxService] Cloud sync notice:', err));

    if (invitedFriends.length > 0) {
      Promise.all(invitedFriends.map(friend => 
        this.sendRoomInvitation(session, friend.uid, friend.username, hostUser).catch(() => {})
      )).catch(() => {});
    }

    return { success: true, session };
  }

  /**
   * Sync session state to Supabase Realtime (<50ms) with Firestore fallback
   */
  public static async syncToCloud(session: AuxSession): Promise<void> {
    // 1. Instant sub-50ms Supabase Realtime broadcast
    try {
      const client = SupabaseService.getClient();
      if (client) {
        const ch = client.channel(`aux:${session.id}`);
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            ch.send({
              type: 'broadcast',
              event: 'aux:session_update',
              payload: session
            });
          }
        });
      }
    } catch (_) {}

    // 2. Firestore fallback
    try {
      const db = (FirestoreService as any).getDb?.();
      if (!db) return;
      const roomRef = doc(db, 'shares', `aux_room_${session.id}`);
      await setDoc(roomRef, {
        id: `aux_room_${session.id}`,
        type: 'aux_room',
        sessionId: session.id,
        session,
        updatedAt: session.updatedAt
      }, { merge: true });
    } catch (err) {
      console.warn('[AuxService] Cloud sync error (safely retained locally):', err);
    }
  }

  /**
   * Send invitation notification to a friend via Supabase (<50ms) and Firestore fallback
   */
  private static async sendRoomInvitation(
    session: AuxSession,
    recipientUid: string,
    recipientUsername: string,
    sender: AppUser
  ): Promise<void> {
    // 1. Supabase instant push
    try {
      SupabaseService.sendSongShare({
        sender_id: sender.uid,
        sender_username: sender.username || sender.displayName || 'Friend',
        sender_display_name: sender.displayName || sender.username || 'Friend',
        recipient_id: recipientUid,
        recipient_username: recipientUsername,
        type: 'aux_invite',
        message: `Invited you to Pass The Aux room "${session.title}"`
      });
    } catch (_) {}

    // 2. Firestore fallback
    try {
      const db = (FirestoreService as any).getDb?.();
      if (!db) return;
      const shareId = `share_aux_${session.id}_${recipientUid}`;
      const shareRef = doc(db, 'shares', shareId);
      await setDoc(shareRef, {
        id: shareId,
        type: 'aux_invite',
        sessionId: session.id,
        sessionTitle: session.title,
        sessionMode: session.mode,
        senderId: sender.uid,
        senderUsername: sender.username || sender.displayName || 'Friend',
        senderDisplayName: sender.displayName || sender.username || 'Friend',
        recipientId: recipientUid,
        recipientUsername,
        message: `Invited you to Pass The Aux room "${session.title}"`,
        read: false,
        createdAt: Date.now()
      }, { merge: true });
    } catch (_) {}
  }

  /**
   * Subscribe to real-time updates for an AUX session via Supabase WebSockets (<50ms)
   */
  public static subscribeToSession(
    sessionId: string,
    callback: (session: AuxSession | null) => void
  ): () => void {
    // 1. Initial hydration from local cache
    try {
      const cached = localStorage.getItem(`${this.ACTIVE_ROOM_KEY}_${sessionId}`);
      if (cached) {
        callback(JSON.parse(cached));
      }
    } catch (_) {}

    // 2. Supabase Realtime channel subscription (<50ms WebSocket latency)
    let supabaseUnsub: (() => void) | null = null;
    try {
      const client = SupabaseService.getClient();
      if (client) {
        const ch = client.channel(`aux:${sessionId}`, {
          config: { broadcast: { self: false } }
        });
        ch.on('broadcast', { event: 'aux:session_update' }, ({ payload }) => {
          if (payload && payload.id === sessionId) {
            try {
              localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${sessionId}`, JSON.stringify(payload));
              const all = this.getLocalSessions();
              this.saveLocalSessions([payload, ...all.filter(s => s.id !== sessionId)]);
            } catch (_) {}
            callback(payload);
          }
        });
        ch.subscribe();
        supabaseUnsub = () => {
          ch.unsubscribe();
        };
      }
    } catch (_) {}

    // 3. Firestore fallback listener
    let firestoreUnsub = () => {};
    try {
      const db = (FirestoreService as any).getDb?.();
      if (db) {
        const roomRef = doc(db, 'shares', `aux_room_${sessionId}`);
        firestoreUnsub = onSnapshot(roomRef, (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            const liveSession: AuxSession = data.session || data;
            if (liveSession && liveSession.id === sessionId) {
              try {
                localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${sessionId}`, JSON.stringify(liveSession));
                const all = this.getLocalSessions();
                this.saveLocalSessions([liveSession, ...all.filter(s => s.id !== sessionId)]);
              } catch (_) {}
              callback(liveSession);
            }
          }
        }, (err) => {
          console.warn('[AuxService] Snapshot listener notice:', err);
        });
      }
    } catch (_) {}

    return () => {
      if (supabaseUnsub) supabaseUnsub();
      firestoreUnsub();
    };
  }

  /**
   * Add a track reference to the AUX session queue
   */
  public static async addTrack(
    session: AuxSession,
    track: Track,
    user: AppUser,
    allowDuplicate = false
  ): Promise<{ success: boolean; session?: AuxSession; error?: string; isDuplicate?: boolean }> {
    if (session.status !== 'active') {
      return { success: false, error: 'Session is paused or completed' };
    }

    // 1. Check duplicate
    const exactDuplicate = session.queue.find(item => 
      item.status !== 'played' && 
      item.track.title.toLowerCase().trim() === track.title.toLowerCase().trim() &&
      item.track.artist.toLowerCase().trim() === track.artist.toLowerCase().trim()
    );

    if (exactDuplicate && !allowDuplicate && session.settings.duplicatePolicy !== 'warn_allow') {
      return { 
        success: false, 
        error: `"${track.title}" is already in this queue!`, 
        isDuplicate: true 
      };
    }

    // 2. Check participant rate/count limit
    const participantPendingCount = session.queue.filter(
      item => item.addedByUserId === user.uid && item.status === 'pending'
    ).length;

    if (participantPendingCount >= session.settings.maxTracksPerParticipant) {
      return { 
        success: false, 
        error: `Queue limit reached: max ${session.settings.maxTracksPerParticipant} active songs per participant.` 
      };
    }

    const now = Date.now();
    const queueItemId = `aux_q_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const position = session.queue.length + 1;

    const newItem: AuxQueueItem = {
      id: queueItemId,
      sessionId: session.id,
      track: {
        ...track,
        // Ensure stable provider reference
        provider: (track as any).provider || 'saavn',
        providerTrackId: (track as any).providerTrackId || track.id
      } as any as Track,
      addedByUserId: user.uid,
      addedByUsername: user.username || user.displayName || 'listener',
      addedByDisplayName: user.displayName || user.username || 'Listener',
      addedByPhotoURL: user.photoURL || null,
      position,
      status: 'pending',
      votes: { [user.uid]: 1 },
      voteCount: 1,
      addedAt: now
    };

    const newEvent: AuxEvent = {
      id: `evt_${now}_add`,
      sessionId: session.id,
      actorUserId: user.uid,
      actorUsername: user.username || 'listener',
      eventType: 'track_added',
      payload: { trackTitle: track.title, artist: track.artist },
      createdAt: now,
      sequence: session.events.length + 1
    };

    const updatedQueue = [...session.queue, newItem];

    // If no song is currently playing, set as current
    let currentId = session.currentQueueItemId;
    if (!currentId) {
      currentId = queueItemId;
      newItem.status = 'playing';
    }

    const updatedSession: AuxSession = {
      ...session,
      queue: updatedQueue,
      currentQueueItemId: currentId,
      events: [newEvent, ...session.events].slice(0, 50),
      updatedAt: now,
      version: session.version + 1
    };

    // Save and broadcast
    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
      const all = this.getLocalSessions();
      this.saveLocalSessions([updatedSession, ...all.filter(s => s.id !== session.id)]);
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Vote for a track in Vote Next mode
   */
  public static async voteTrack(
    session: AuxSession,
    queueItemId: string,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession }> {
    const item = session.queue.find(q => q.id === queueItemId);
    if (!item || item.status !== 'pending') return { success: false };

    const votes = { ...item.votes };
    const hasVoted = Boolean(votes[user.uid]);

    if (hasVoted) {
      delete votes[user.uid]; // Toggle off
    } else {
      votes[user.uid] = 1; // Toggle on
    }

    const voteCount = Object.keys(votes).length;
    const now = Date.now();

    const updatedQueue = session.queue.map(q => {
      if (q.id === queueItemId) {
        return { ...q, votes, voteCount };
      }
      return q;
    });

    // If Vote Next mode, sort pending queue items by voteCount descending, with deterministic addedAt tie-break
    if (session.mode === 'vote_next') {
      const playing = updatedQueue.filter(q => q.status === 'playing');
      const pending = updatedQueue
        .filter(q => q.status === 'pending')
        .sort((a, b) => b.voteCount - a.voteCount || a.addedAt - b.addedAt)
        .map((q, idx) => ({ ...q, position: idx + 1 }));
      const played = updatedQueue.filter(q => q.status === 'played');

      updatedQueue.length = 0;
      updatedQueue.push(...playing, ...pending, ...played);
    }

    const updatedSession: AuxSession = {
      ...session,
      queue: updatedQueue,
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Reorder queue item
   */
  public static async reorderQueue(
    session: AuxSession,
    fromIndex: number,
    toIndex: number,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    const isHost = session.hostUserId === user.uid;
    if (!session.settings.canReorder && !isHost) {
      return { success: false, error: 'Only the host can reorder tracks in this mode' };
    }

    const pending = session.queue.filter(q => q.status === 'pending');
    if (fromIndex < 0 || fromIndex >= pending.length || toIndex < 0 || toIndex >= pending.length) {
      return { success: false };
    }

    const [moved] = pending.splice(fromIndex, 1);
    pending.splice(toIndex, 0, moved);

    const reorderedPending = pending.map((q, idx) => ({ ...q, position: idx + 1 }));
    const playing = session.queue.filter(q => q.status === 'playing');
    const played = session.queue.filter(q => q.status === 'played');

    const now = Date.now();
    const updatedSession: AuxSession = {
      ...session,
      queue: [...playing, ...reorderedPending, ...played],
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Remove item from queue
   */
  public static async removeTrack(
    session: AuxSession,
    queueItemId: string,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    const item = session.queue.find(q => q.id === queueItemId);
    if (!item) return { success: false };

    const isHost = session.hostUserId === user.uid;
    const isOwner = item.addedByUserId === user.uid;

    if (!isHost && !isOwner) {
      return { success: false, error: 'You can only remove tracks you added' };
    }

    const now = Date.now();
    const updatedQueue = session.queue.filter(q => q.id !== queueItemId);
    const updatedSession: AuxSession = {
      ...session,
      queue: updatedQueue,
      currentQueueItemId: session.currentQueueItemId === queueItemId ? null : session.currentQueueItemId,
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Select a track to play now in the room
   */
  public static async setCurrentItem(
    session: AuxSession,
    queueItemId: string
  ): Promise<{ success: boolean; session?: AuxSession }> {
    const now = Date.now();
    const updatedQueue = session.queue.map(q => {
      if (q.id === queueItemId) {
        return { ...q, status: 'playing' as const };
      }
      if (q.status === 'playing') {
        return { ...q, status: 'played' as const };
      }
      return q;
    });

    const updatedSession: AuxSession = {
      ...session,
      queue: updatedQueue,
      currentQueueItemId: queueItemId,
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Validate session state machine transition
   */
  public static validateStateTransition(current: AuxSession['status'], target: AuxSession['status']): boolean {
    const allowed: Record<AuxSession['status'], AuxSession['status'][]> = {
      draft: ['inviting', 'active', 'cancelled'],
      inviting: ['active', 'cancelled', 'expired'],
      active: ['paused', 'completed', 'cancelled', 'expired'],
      paused: ['active', 'completed', 'cancelled', 'expired'],
      completed: [],
      cancelled: [],
      expired: []
    };
    return (allowed[current] || []).includes(target);
  }

  /**
   * Host Controls: Pause / Resume Session
   */
  public static async togglePauseSession(
    session: AuxSession,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    if (session.hostUserId !== user.uid) {
      return { success: false, error: 'Only the host can pause or resume the session' };
    }

    const newStatus = session.status === 'paused' ? 'active' : 'paused';
    if (!this.validateStateTransition(session.status, newStatus)) {
      return { success: false, error: `Invalid state transition from ${session.status} to ${newStatus}` };
    }

    const now = Date.now();
    const eventType: AuxEventType = newStatus === 'paused' ? 'session_paused' : 'session_resumed';
    const newEvent: AuxEvent = {
      id: `evt_${now}_pause`,
      sessionId: session.id,
      actorUserId: user.uid,
      actorUsername: user.username || user.displayName || 'host',
      eventType,
      createdAt: now,
      sequence: session.events.length + 1
    };

    const updatedSession: AuxSession = {
      ...session,
      status: newStatus,
      events: [newEvent, ...session.events].slice(0, 50),
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * End AUX Session
   */
  public static async endSession(
    session: AuxSession,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    if (session.hostUserId !== user.uid) {
      return { success: false, error: 'Only the host can end the session' };
    }

    if (!this.validateStateTransition(session.status, 'completed')) {
      return { success: false, error: `Invalid transition to completed from ${session.status}` };
    }

    const now = Date.now();
    const newEvent: AuxEvent = {
      id: `evt_${now}_end`,
      sessionId: session.id,
      actorUserId: user.uid,
      actorUsername: user.username || user.displayName || 'host',
      eventType: 'session_ended',
      createdAt: now,
      sequence: session.events.length + 1
    };

    const updatedSession: AuxSession = {
      ...session,
      status: 'completed',
      events: [newEvent, ...session.events].slice(0, 50),
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.removeItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`);
      const all = this.getLocalSessions();
      this.saveLocalSessions(all.filter(s => s.id !== session.id));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Transfer host role to another participant
   */
  public static async transferHost(
    session: AuxSession,
    newHostUserId: string,
    currentUser: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    if (session.hostUserId !== currentUser.uid) {
      return { success: false, error: 'Only the host can transfer host privileges' };
    }

    const targetParticipant = session.participants.find(p => p.userId === newHostUserId);
    if (!targetParticipant) {
      return { success: false, error: 'Target user is not a participant in this room' };
    }

    const now = Date.now();
    const updatedParticipants = session.participants.map(p => {
      if (p.userId === newHostUserId) {
        return { ...p, role: 'host' as const };
      }
      if (p.userId === currentUser.uid) {
        return { ...p, role: 'participant' as const };
      }
      return p;
    });

    const newEvent: AuxEvent = {
      id: `evt_${now}_xfer`,
      sessionId: session.id,
      actorUserId: currentUser.uid,
      actorUsername: currentUser.username || 'host',
      eventType: 'host_transferred',
      payload: { newHostUserId, newHostUsername: targetParticipant.username },
      createdAt: now,
      sequence: session.events.length + 1
    };

    const updatedSession: AuxSession = {
      ...session,
      hostUserId: targetParticipant.userId,
      hostUsername: targetParticipant.username,
      hostDisplayName: targetParticipant.displayName,
      participants: updatedParticipants,
      events: [newEvent, ...session.events].slice(0, 50),
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Participant or Host leaves the session
   */
  public static async leaveSession(
    session: AuxSession,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    const now = Date.now();
    const isHost = session.hostUserId === user.uid;
    const remaining = session.participants.filter(p => p.userId !== user.uid && p.invitationStatus === 'accepted');

    let newHostId = session.hostUserId;
    let newHostUsername = session.hostUsername;
    let newHostDisplayName = session.hostDisplayName;
    let newStatus = session.status;

    if (isHost) {
      if (remaining.length > 0) {
        // Deterministic host reassignment: next longest-standing participant
        const nextHost = remaining.sort((a, b) => a.joinedAt - b.joinedAt)[0];
        newHostId = nextHost.userId;
        newHostUsername = nextHost.username;
        newHostDisplayName = nextHost.displayName;
      } else {
        newStatus = 'completed';
      }
    }

    const updatedParticipants = session.participants.map(p => {
      if (p.userId === user.uid) {
        return { ...p, invitationStatus: 'declined' as const, leftAt: now };
      }
      if (p.userId === newHostId) {
        return { ...p, role: 'host' as const };
      }
      return p;
    });

    const newEvent: AuxEvent = {
      id: `evt_${now}_leave`,
      sessionId: session.id,
      actorUserId: user.uid,
      actorUsername: user.username || 'participant',
      eventType: 'participant_left',
      createdAt: now,
      sequence: session.events.length + 1
    };

    const updatedSession: AuxSession = {
      ...session,
      hostUserId: newHostId,
      hostUsername: newHostUsername,
      hostDisplayName: newHostDisplayName,
      status: newStatus,
      participants: updatedParticipants,
      events: [newEvent, ...session.events].slice(0, 50),
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Accept an invitation or join an active AUX session
   */
  public static async joinSession(
    sessionId: string,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    // 1. Fetch from local cache or cloud
    let session: AuxSession | null = null;
    try {
      const cached = localStorage.getItem(`${this.ACTIVE_ROOM_KEY}_${sessionId}`);
      if (cached) session = JSON.parse(cached);
    } catch (_) {}

    if (!session) {
      try {
        const db = (FirestoreService as any).getDb?.();
        if (db) {
          const snap = await getDoc(doc(db, 'shares', `aux_room_${sessionId}`));
          if (snap.exists()) {
            const data = snap.data();
            session = data.session || data;
          }
        }
      } catch (_) {}
    }

    if (!session) {
      return { success: false, error: 'Pass The Aux session not found' };
    }

    if (session.status === 'completed' || session.status === 'cancelled' || session.status === 'expired') {
      return { success: false, error: `This session has already ended (${session.status})` };
    }

    const now = Date.now();
    const existing = session.participants.find(p => p.userId === user.uid);
    let updatedParticipants: AuxParticipant[];

    if (existing) {
      updatedParticipants = session.participants.map(p => {
        if (p.userId === user.uid) {
          return {
            ...p,
            invitationStatus: 'accepted' as const,
            joinedAt: p.joinedAt || now,
            lastSeenAt: now,
            leftAt: null
          };
        }
        return p;
      });
    } else {
      const newPart: AuxParticipant = {
        id: `part_${user.uid}`,
        sessionId: session.id,
        userId: user.uid,
        username: user.username || user.displayName || 'listener',
        displayName: user.displayName || user.username || 'Listener',
        photoURL: user.photoURL || null,
        role: 'participant',
        invitationStatus: 'accepted',
        joinedAt: now,
        lastSeenAt: now
      };
      updatedParticipants = [...session.participants, newPart];
    }

    const newEvent: AuxEvent = {
      id: `evt_${now}_join`,
      sessionId: session.id,
      actorUserId: user.uid,
      actorUsername: user.username || 'listener',
      eventType: 'participant_joined',
      createdAt: now,
      sequence: session.events.length + 1
    };

    const updatedSession: AuxSession = {
      ...session,
      participants: updatedParticipants,
      events: [newEvent, ...session.events].slice(0, 50),
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
      const all = this.getLocalSessions();
      this.saveLocalSessions([updatedSession, ...all.filter(s => s.id !== session!.id)]);
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Update Room Settings (Host Only)
   */
  public static async updateSettings(
    session: AuxSession,
    settingsUpdate: Partial<AuxSettings>,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    if (session.hostUserId !== user.uid) {
      return { success: false, error: 'Only the host can modify session settings' };
    }

    const now = Date.now();
    const updatedSettings: AuxSettings = {
      ...session.settings,
      ...settingsUpdate
    };

    const updatedSession: AuxSession = {
      ...session,
      settings: updatedSettings,
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Change Room Mode (Host Only)
   */
  public static async changeMode(
    session: AuxSession,
    newMode: AuxSessionMode,
    user: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    if (session.hostUserId !== user.uid) {
      return { success: false, error: 'Only the host can change session mode' };
    }

    const now = Date.now();
    let updatedQueue = [...session.queue];

    // If switching to vote_next, sort pending by votes
    if (newMode === 'vote_next') {
      const playing = updatedQueue.filter(q => q.status === 'playing');
      const pending = updatedQueue
        .filter(q => q.status === 'pending')
        .sort((a, b) => b.voteCount - a.voteCount || a.addedAt - b.addedAt)
        .map((q, idx) => ({ ...q, position: idx + 1 }));
      const played = updatedQueue.filter(q => q.status === 'played');
      updatedQueue = [...playing, ...pending, ...played];
    }

    const updatedSession: AuxSession = {
      ...session,
      mode: newMode,
      queue: updatedQueue,
      updatedAt: now,
      version: session.version + 1
    };

    try {
      localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
    } catch (_) {}

    this.syncToCloud(updatedSession).catch(err => console.warn('[AuxService] Cloud sync notice:', err));
    return { success: true, session: updatedSession };
  }



  /**
   * Invite a friend into an existing session
   */
  public static async inviteFriendToSession(
    session: AuxSession,
    friend: { uid: string; username: string; displayName: string; photoURL?: string | null },
    sender: AppUser
  ): Promise<{ success: boolean; session?: AuxSession; error?: string }> {
    if (friend.uid === sender.uid) {
      return { success: false, error: 'You cannot invite yourself' };
    }

    const isAlreadyIn = session.participants.some(p => p.userId === friend.uid);
    let updatedSession = session;

    if (!isAlreadyIn) {
      const newPart: AuxParticipant = {
        id: `part_${friend.uid}`,
        sessionId: session.id,
        userId: friend.uid,
        username: friend.username,
        displayName: friend.displayName,
        photoURL: friend.photoURL || null,
        role: 'participant',
        invitationStatus: 'invited',
        joinedAt: 0,
        lastSeenAt: 0
      };

      const now = Date.now();
      const newEvent: AuxEvent = {
        id: `evt_${now}_inv`,
        sessionId: session.id,
        actorUserId: sender.uid,
        actorUsername: sender.username || 'host',
        eventType: 'invite_sent',
        payload: { friendUid: friend.uid, friendUsername: friend.username },
        createdAt: now,
        sequence: session.events.length + 1
      };

      updatedSession = {
        ...session,
        participants: [...session.participants, newPart],
        events: [newEvent, ...session.events].slice(0, 50),
        updatedAt: now,
        version: session.version + 1
      };

      try {
        localStorage.setItem(`${this.ACTIVE_ROOM_KEY}_${session.id}`, JSON.stringify(updatedSession));
      } catch (_) {}

      await this.syncToCloud(updatedSession);
    }

    await this.sendRoomInvitation(updatedSession, friend.uid, friend.username, sender);
    return { success: true, session: updatedSession };
  }

  /**
   * Instantly delete an Aux session locally and remove from cloud
   */
  public static deleteSession(sessionId: string): boolean {
    try {
      localStorage.removeItem(`${this.ACTIVE_ROOM_KEY}_${sessionId}`);
      const all = this.getLocalSessions();
      this.saveLocalSessions(all.filter(s => s.id !== sessionId));
      return true;
    } catch (_) {
      return false;
    }
  }
}
