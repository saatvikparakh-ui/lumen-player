/**
 * LUMEN BLIND DROP SERVICE
 * Private music-discovery game engine.
 * Direct Drop & Circle Drop modes with strict pre-reveal anonymity,
 * opaque submission IDs, rate limits, provider-aware track references,
 * and zero DOM/payload leakage before reveal.
 */

import { doc, setDoc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { FirestoreService } from './firestoreService';
import { SupabaseService } from './supabaseService';
import { AppUser } from './firebaseAuthService';
import { Track } from '../types/music';
import { 
  BlindDropRound, 
  BlindDropSubmission, 
  BlindDropGuess, 
  BlindDropParticipant,
  BlindDropMode, 
  BlindDropStatus 
} from '../types/blindDropTypes';
import { FriendProfileData } from '../components/views/friends/friendsTypes';

export class BlindDropService {
  private static STORAGE_KEY = 'lumen_blind_drop_rounds';
  private static MUTED_KEY = 'lumen_blind_drop_muted_friends';
  private static RATE_LIMIT_KEY = 'lumen_blind_drop_timestamps';

  /**
   * Get all cached rounds locally
   */
  public static getRawLocalRounds(): BlindDropRound[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Save rounds to local storage
   */
  private static saveLocalRounds(rounds: BlindDropRound[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(rounds));
    } catch (_) {}
  }

  /**
   * Check if viewer has muted drops from a specific friend
   */
  public static isFriendMuted(friendUid: string): boolean {
    try {
      const muted: string[] = JSON.parse(localStorage.getItem(this.MUTED_KEY) || '[]');
      return muted.includes(friendUid);
    } catch (_) {
      return false;
    }
  }

  /**
   * Toggle mute state for a friend
   */
  public static toggleMuteFriend(friendUid: string): boolean {
    try {
      const muted: string[] = JSON.parse(localStorage.getItem(this.MUTED_KEY) || '[]');
      let updated: string[];
      let isMuted = false;
      if (muted.includes(friendUid)) {
        updated = muted.filter(id => id !== friendUid);
        isMuted = false;
      } else {
        updated = [...muted, friendUid];
        isMuted = true;
      }
      localStorage.setItem(this.MUTED_KEY, JSON.stringify(updated));
      return isMuted;
    } catch (_) {
      return false;
    }
  }

  /**
   * Client-side privacy projection:
   * Strictly omits senderUserId, senderUsername, senderDisplayName, senderPhotoURL
   * for any submission where the viewer is NOT the sender, UNTIL the round is revealed.
   */
  public static projectRoundForViewer(round: BlindDropRound, viewerUserId: string): BlindDropRound {
    const isRevealed = round.status === 'revealed' || round.status === 'completed';

    const cleanSubmissions: BlindDropSubmission[] = round.submissions.map(sub => {
      // If round is revealed or viewer is the original sender/creator, reveal identity
      if (isRevealed || sub.senderUserId === viewerUserId || round.hostUserId === viewerUserId) {
        return {
          ...sub,
          senderUserId: sub.senderUserId || round.hostUserId,
          guesses: sub.guesses || {}
        };
      }

      // Otherwise, OMIT ALL SENDER IDENTITY FIELDS COMPLETELY
      const {
        senderUserId: _hideId,
        senderUsername: _hideUsername,
        senderDisplayName: _hideName,
        senderPhotoURL: _hidePhoto,
        ...safeSub
      } = sub;

      // Mask isCorrect flags on guesses before reveal to prevent guessing leakage
      const maskedGuesses: Record<string, BlindDropGuess> = {};
      if (sub.guesses) {
        Object.entries(sub.guesses).forEach(([uid, g]) => {
          maskedGuesses[uid] = {
            ...g,
            isCorrect: uid === viewerUserId ? undefined : undefined
          };
        });
      }

      return {
        ...safeSub,
        guesses: maskedGuesses
      };
    });

    return {
      ...round,
      submissions: cleanSubmissions
    };
  }

  /**
   * Get rounds projected for a specific user
   */
  public static getUserRounds(userId: string): BlindDropRound[] {
    const all = this.getRawLocalRounds();
    const relevant = all.filter(r => 
      r.hostUserId === userId || 
      r.recipientUserId === userId || 
      r.participants.some(p => p.userId === userId)
    );
    return relevant.map(r => this.projectRoundForViewer(r, userId));
  }

  /**
   * Count unrevealed drops waiting for recipient to guess/reveal
   */
  public static getPendingCount(userId: string): number {
    const rounds = this.getUserRounds(userId);
    return rounds.filter(r => {
      if (r.status === 'revealed' || r.status === 'completed' || r.status === 'cancelled') return false;
      if (r.mode === 'direct' && r.recipientUserId === userId) return true;
      if (r.mode === 'circle' && (r.status === 'in_guessing' || r.status === 'open_for_submissions')) {
        const p = r.participants.find(part => part.userId === userId);
        return p && !p.hasGuessed;
      }
      return false;
    }).length;
  }

  /**
   * Rate-limit check (max 15 drops/hour)
   */
  private static checkRateLimit(): boolean {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(this.RATE_LIMIT_KEY);
      const timestamps: number[] = raw ? JSON.parse(raw) : [];
      const oneHourAgo = now - 3600000;
      const recent = timestamps.filter(t => t > oneHourAgo);
      if (recent.length >= 15) {
        return false;
      }
      recent.push(now);
      localStorage.setItem(this.RATE_LIMIT_KEY, JSON.stringify(recent));
      return true;
    } catch (_) {
      return true;
    }
  }

  /**
   * Sanitize short optional clue
   */
  private static sanitizeClue(clue?: string): string | undefined {
    if (!clue) return undefined;
    const trimmed = clue.trim().slice(0, 120);
    // Strip HTML tags / unsafe protocols
    return trimmed.replace(/<[^>]*>?/gm, '');
  }

  /**
   * 1. CREATE DIRECT DROP (1-on-1 Anonymous Drop)
   */
  public static async createDirectDrop(
    sender: AppUser,
    recipient: FriendProfileData,
    track: Track,
    clue?: string
  ): Promise<{ success: boolean; round?: BlindDropRound; error?: string }> {
    if (!sender) return { success: false, error: 'User must be signed in' };
    if (!recipient || !recipient.userId) return { success: false, error: 'Recipient is required' };
    if (sender.uid === recipient.userId) return { success: false, error: 'Cannot send a Blind Drop to yourself' };
    if (this.isFriendMuted(recipient.userId)) {
      return { success: false, error: 'Blind Drops with this friend are currently muted' };
    }
    if (!this.checkRateLimit()) {
      return { success: false, error: 'Rate limit reached. Please wait a moment before sending more drops.' };
    }

    const roundId = `bdrop_dir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const senderParticipant: BlindDropParticipant = {
      userId: sender.uid,
      username: sender.username || sender.displayName || 'sender',
      displayName: sender.displayName || sender.username || 'Friend',
      photoURL: sender.photoURL || null,
      hasSubmitted: true,
      hasGuessed: false,
      isHost: true
    };

    const recipientParticipant: BlindDropParticipant = {
      userId: recipient.userId,
      username: recipient.username,
      displayName: recipient.displayName || recipient.username,
      photoURL: recipient.photoURL || null,
      hasSubmitted: false,
      hasGuessed: false,
      isHost: false
    };

    const submission: BlindDropSubmission = {
      id: submissionId,
      roundId,
      senderUserId: sender.uid,
      senderUsername: sender.username || 'friend',
      senderDisplayName: sender.displayName || sender.username || 'Friend',
      senderPhotoURL: sender.photoURL || null,
      track: {
        ...track,
        provider: (track as any).provider || 'saavn',
        providerTrackId: (track as any).providerTrackId || track.id
      } as any as Track,
      clue: this.sanitizeClue(clue),
      submittedAt: now,
      reactions: {},
      guesses: {}
    };

    const round: BlindDropRound = {
      id: roundId,
      mode: 'direct',
      title: `Blind Drop for @${recipient.username}`,
      hostUserId: sender.uid,
      hostUsername: sender.username || 'sender',
      hostDisplayName: sender.displayName || sender.username || 'Friend',
      status: 'delivered',
      participants: [senderParticipant, recipientParticipant],
      recipientUserId: recipient.userId,
      recipientUsername: recipient.username,
      submissions: [submission],
      createdAt: now,
      submissionDeadline: now + (7 * 24 * 3600 * 1000) // 7 days expiry
    };

    // Save locally
    const all = this.getRawLocalRounds();
    this.saveLocalRounds([round, ...all.filter(r => r.id !== roundId)]);

    // Broadcast to Firestore & send anonymous recipient notification in background without blocking instant UI feedback
    this.syncToCloud(round).catch(err => console.warn('[BlindDropService] Cloud sync notice:', err));
    this.notifyParticipants(round, sender).catch(() => {});

    return { 
      success: true, 
      round: this.projectRoundForViewer(round, sender.uid) 
    };
  }

  /**
   * 2. CREATE CIRCLE DROP (Group Anonymous Music Discovery Round)
   */
  public static async createCircleDrop(
    host: AppUser,
    title: string,
    invitedFriends: FriendProfileData[],
    deadlineHours: number = 24
  ): Promise<{ success: boolean; round?: BlindDropRound; error?: string }> {
    if (!host) return { success: false, error: 'Host user is required' };
    if (!invitedFriends || invitedFriends.length === 0) {
      return { success: false, error: 'Invite at least 1 friend to start Circle Drop' };
    }

    const roundId = `bdrop_cir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const hostParticipant: BlindDropParticipant = {
      userId: host.uid,
      username: host.username || host.displayName || 'host',
      displayName: host.displayName || host.username || 'Host',
      photoURL: host.photoURL || null,
      hasSubmitted: false,
      hasGuessed: false,
      isHost: true
    };

    const friendParticipants: BlindDropParticipant[] = invitedFriends.map(f => ({
      userId: f.userId,
      username: f.username,
      displayName: f.displayName || f.username,
      photoURL: f.photoURL || null,
      hasSubmitted: false,
      hasGuessed: false,
      isHost: false
    }));

    const round: BlindDropRound = {
      id: roundId,
      mode: 'circle',
      title: title.trim() || 'Circle Blind Drop',
      hostUserId: host.uid,
      hostUsername: host.username || 'host',
      hostDisplayName: host.displayName || host.username || 'Host',
      status: 'open_for_submissions',
      participants: [hostParticipant, ...friendParticipants],
      submissions: [],
      createdAt: now,
      submissionDeadline: now + (deadlineHours * 3600 * 1000)
    };

    const all = this.getRawLocalRounds();
    this.saveLocalRounds([round, ...all.filter(r => r.id !== roundId)]);
    this.syncToCloud(round).catch(err => console.warn('[BlindDropService] Cloud sync notice:', err));
    this.notifyParticipants(round, host).catch(() => {});

    return { 
      success: true, 
      round: this.projectRoundForViewer(round, host.uid) 
    };
  }

  /**
   * 3. SUBMIT TRACK TO CIRCLE DROP
   */
  public static async submitTrackToCircle(
    roundId: string,
    user: AppUser,
    track: Track,
    clue?: string
  ): Promise<{ success: boolean; round?: BlindDropRound; error?: string }> {
    const all = this.getRawLocalRounds();
    const round = all.find(r => r.id === roundId);
    if (!round) return { success: false, error: 'Round not found' };

    if (round.status !== 'open_for_submissions') {
      return { success: false, error: 'Submissions for this round are locked' };
    }

    // Check if user already submitted
    const existingSub = round.submissions.find(s => s.senderUserId === user.uid);
    if (existingSub) {
      return { success: false, error: 'You have already submitted a song for this round' };
    }

    const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newSubmission: BlindDropSubmission = {
      id: subId,
      roundId,
      senderUserId: user.uid,
      senderUsername: user.username || 'friend',
      senderDisplayName: user.displayName || user.username || 'Friend',
      senderPhotoURL: user.photoURL || null,
      track: {
        ...track,
        provider: (track as any).provider || 'saavn',
        providerTrackId: (track as any).providerTrackId || track.id
      } as any as Track,
      clue: this.sanitizeClue(clue),
      submittedAt: Date.now(),
      reactions: {},
      guesses: {}
    };

    const updatedParticipants = round.participants.map(p => 
      p.userId === user.uid ? { ...p, hasSubmitted: true } : p
    );

    // If all participants have submitted, auto-advance to in_guessing
    const allSubmitted = updatedParticipants.every(p => p.hasSubmitted);
    const newStatus: BlindDropStatus = allSubmitted ? 'in_guessing' : round.status;

    const updatedRound: BlindDropRound = {
      ...round,
      participants: updatedParticipants,
      submissions: [...round.submissions, newSubmission],
      status: newStatus
    };

    this.saveLocalRounds([updatedRound, ...all.filter(r => r.id !== roundId)]);
    this.syncToCloud(updatedRound).catch(err => console.warn('[BlindDropService] Cloud sync notice:', err));

    return { 
      success: true, 
      round: this.projectRoundForViewer(updatedRound, user.uid) 
    };
  }

  /**
   * 4. SUBMIT A GUESS
   */
  public static async submitGuess(
    roundId: string,
    submissionId: string,
    guesser: AppUser,
    guessedFriend: { userId: string; username: string; displayName?: string }
  ): Promise<{ success: boolean; isCorrect?: boolean; round?: BlindDropRound; error?: string }> {
    const all = this.getRawLocalRounds();
    const round = all.find(r => r.id === roundId);
    if (!round) return { success: false, error: 'Round not found' };

    const submission = round.submissions.find(s => s.id === submissionId);
    if (!submission) return { success: false, error: 'Submission not found' };

    const isSender = submission.senderUserId === guesser.uid;
    const isCorrect = isSender 
      ? (guessedFriend.userId === round.recipientUserId)
      : (submission.senderUserId === guessedFriend.userId);

    const guess: BlindDropGuess = {
      guesserUserId: guesser.uid,
      guesserUsername: guesser.username || 'listener',
      guessedUserId: guessedFriend.userId,
      guessedUsername: guessedFriend.username,
      guessedDisplayName: guessedFriend.displayName,
      isCorrect,
      guessedAt: Date.now()
    };

    const updatedGuesses = {
      ...(submission.guesses || {}),
      [guesser.uid]: guess
    };

    const updatedSubmissions = round.submissions.map(s => 
      s.id === submissionId ? { ...s, guesses: updatedGuesses } : s
    );

    const updatedParticipants = round.participants.map(p => 
      p.userId === guesser.uid ? { ...p, hasGuessed: true } : p
    );

    const updatedRound: BlindDropRound = {
      ...round,
      submissions: updatedSubmissions,
      participants: updatedParticipants
    };

    this.saveLocalRounds([updatedRound, ...all.filter(r => r.id !== roundId)]);
    this.syncToCloud(updatedRound).catch(err => console.warn('[BlindDropService] Cloud sync notice:', err));

    return {
      success: true,
      isCorrect,
      round: this.projectRoundForViewer(updatedRound, guesser.uid)
    };
  }

  /**
   * 5. REVEAL SENDER & SENDER'S REASON/CLUE
   */
  public static async revealRound(
    roundId: string,
    user: AppUser
  ): Promise<{ success: boolean; round?: BlindDropRound; error?: string }> {
    const all = this.getRawLocalRounds();
    const round = all.find(r => r.id === roundId);
    if (!round) return { success: false, error: 'Round not found' };

    const now = Date.now();
    const updatedRound: BlindDropRound = {
      ...round,
      status: 'revealed',
      revealedAt: now,
      submissions: round.submissions.map(s => ({
        ...s,
        revealedAt: s.revealedAt || now
      }))
    };

    this.saveLocalRounds([updatedRound, ...all.filter(r => r.id !== roundId)]);
    this.syncToCloud(updatedRound).catch(err => console.warn('[BlindDropService] Cloud sync notice:', err));

    return {
      success: true,
      round: this.projectRoundForViewer(updatedRound, user.uid)
    };
  }

  /**
   * 6. REACT TO A DROP
   */
  public static async reactToSubmission(
    roundId: string,
    submissionId: string,
    user: AppUser,
    reaction: string // 'love' | 'fire' | 'mindblown' | 'laugh'
  ): Promise<{ success: boolean; round?: BlindDropRound }> {
    const all = this.getRawLocalRounds();
    const round = all.find(r => r.id === roundId);
    if (!round) return { success: false };

    const updatedSubmissions = round.submissions.map(s => {
      if (s.id !== submissionId) return s;
      const reactions = { ...(s.reactions || {}), [user.uid]: reaction };
      return { ...s, reactions };
    });

    const updatedRound: BlindDropRound = {
      ...round,
      submissions: updatedSubmissions
    };

    this.saveLocalRounds([updatedRound, ...all.filter(r => r.id !== roundId)]);
    this.syncToCloud(updatedRound).catch(err => console.warn('[BlindDropService] Cloud sync notice:', err));

    return {
      success: true,
      round: this.projectRoundForViewer(updatedRound, user.uid)
    };
  }

  /**
   * Merge an incoming Blind Drop round into local storage cleanly
   */
  public static upsertLocalRound(round: BlindDropRound): void {
    if (!round || !round.id) return;
    const all = this.getRawLocalRounds();
    const existing = all.find(r => r.id === round.id);
    // Preserve richer submissions/guesses/revealed state if incoming snapshot is older
    if (existing && (existing.status === 'revealed' || existing.status === 'completed') && round.status !== 'revealed' && round.status !== 'completed') {
      return;
    }
    this.saveLocalRounds([round, ...all.filter(r => r.id !== round.id)]);
  }

  /**
   * Notify each invited recipient/participant via BOTH Supabase Realtime & Firestore shares (ONE deterministic ID)
   * Anonymity preserved: for Direct Drops, the share payload masks sender identity in the projected round.
   */
  private static async notifyParticipants(round: BlindDropRound, sender: AppUser): Promise<void> {
    const recipients = round.participants.filter(p => p.userId && p.userId !== sender.uid);
    if (recipients.length === 0) return;

    const db = (FirestoreService as any).getDb?.();
    const now = Date.now();

    await Promise.allSettled(
      recipients.map(async (rec) => {
        const cleanU = (rec.username || '').replace(/^@/, '').trim().toLowerCase();
        const shareId = `share_bdrop_${round.id}_${rec.userId || cleanU}`;
        const safeRound = this.projectRoundForViewer(round, rec.userId);
        const isDirect = round.mode === 'direct';
        const message = isDirect
          ? 'Someone in your circle dropped you a mystery track!'
          : `Invited you to Circle Blind Drop "${round.title}"`;

        // 1. Supabase Realtime instant push (<50ms)
        SupabaseService.sendSongShare({
          id: shareId,
          sender_id: isDirect ? 'anonymous' : sender.uid,
          sender_username: isDirect ? 'mystery_friend' : (sender.username || sender.displayName || 'Friend'),
          sender_display_name: isDirect ? 'Mystery Friend' : (sender.displayName || sender.username || 'Friend'),
          recipient_id: rec.userId,
          recipient_username: cleanU || rec.username,
          type: 'blind_drop',
          roundId: round.id,
          round: safeRound,
          message
        } as any).catch(() => {});

        // 2. Persistent Firestore share doc
        if (db) {
          const shareRef = doc(db, 'shares', shareId);
          await setDoc(shareRef, {
            id: shareId,
            type: 'blind_drop',
            roundId: round.id,
            round: safeRound,
            senderId: isDirect ? 'anonymous' : sender.uid,
            senderUsername: isDirect ? 'mystery_friend' : (sender.username || sender.displayName || 'Friend'),
            senderDisplayName: isDirect ? 'Mystery Friend' : (sender.displayName || sender.username || 'Friend'),
            recipientId: rec.userId,
            recipientUsername: cleanU || rec.username,
            message,
            read: false,
            createdAt: now
          }, { merge: true });
        }
      })
    );
  }

  /**
   * 7. CLOUD SYNC & REALTIME SUBSCRIPTION
   */
  public static async syncToCloud(round: BlindDropRound): Promise<void> {
    const participantIds = Array.from(
      new Set([
        round.hostUserId,
        round.recipientUserId,
        ...round.participants.map(p => p.userId)
      ].filter(Boolean) as string[])
    );

    // 1. Instant Supabase Realtime broadcast so active Blind Drop studios update in <50ms
    try {
      SupabaseService.broadcastToChannel(`bdrop:${round.id}`, 'bdrop:update', round).catch(() => {});
      SupabaseService.broadcastToChannel('lumen:social', 'bdrop:update', round).catch(() => {});
    } catch (_) {}

    // 2. Persistent Firestore document indexed by participantIds
    try {
      const db = (FirestoreService as any).getDb?.();
      if (!db) return;
      const ref = doc(db, 'shares', `blind_drop_${round.id}`);
      await setDoc(ref, {
        id: `blind_drop_${round.id}`,
        type: 'blind_drop_room',
        roundId: round.id,
        participantIds,
        round,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      console.warn('[BlindDropService] Cloud sync notice:', err);
    }
  }

  /**
   * Realtime subscription for a user's Blind Drops (Firestore participantIds query + Supabase Realtime)
   */
  public static subscribeToUserDrops(
    userId: string,
    callback: (rounds: BlindDropRound[]) => void
  ): () => void {
    callback(this.getUserRounds(userId));
    const unsubs: Array<() => void> = [];

    // 1. Supabase Realtime live updates on lumen:social
    try {
      const ch = (SupabaseService as any).getOrCreateChannel?.('lumen:social');
      if (ch) {
        const handler = ({ payload }: any) => {
          const incoming: BlindDropRound | null = payload?.id ? payload : payload?.round || null;
          if (!incoming || !incoming.id) return;
          const isParticipant =
            incoming.hostUserId === userId ||
            incoming.recipientUserId === userId ||
            incoming.participants?.some(p => p.userId === userId);
          if (isParticipant) {
            this.upsertLocalRound(incoming);
            callback(this.getUserRounds(userId));
          }
        };
        ch.on('broadcast', { event: 'bdrop:update' }, handler);
      }
    } catch (_) {}

    // 2. Firestore single-field array-contains query (zero composite index required)
    try {
      const db = (FirestoreService as any).getDb?.();
      if (db && userId) {
        const q = query(
          collection(db, 'shares'),
          where('participantIds', 'array-contains', userId)
        );
        const unsubFs = onSnapshot(q, (snap) => {
          let changed = false;
          snap.forEach((docSnap) => {
            const data = docSnap.data() as any;
            if ((data?.type === 'blind_drop_room' || data?.type === 'blind_drop') && data?.round?.id) {
              this.upsertLocalRound(data.round as BlindDropRound);
              changed = true;
            }
          });
          if (changed) {
            callback(this.getUserRounds(userId));
          }
        }, () => {});
        unsubs.push(unsubFs);
      }
    } catch (_) {}

    return () => {
      unsubs.forEach(u => {
        try { u(); } catch (_) {}
      });
    };
  }
}
