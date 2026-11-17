/**
 * LUMEN MINI MIXTAPES SERVICE
 * Lightweight 3 to 7 track curated collections with personal notes and custom covers.
 * Sends song references across friends without duplicating or extracting audio files.
 */

import { doc, setDoc, onSnapshot, getDocs, collection, query, where } from 'firebase/firestore';
import { FirestoreService } from './firestoreService';
import { PlaylistService } from './playlistService';
import { AppUser } from './firebaseAuthService';
import { Track } from '../types/music';
import { 
  MiniMixtape, 
  MiniMixtapeShare, 
  MixtapeCoverStyle 
} from '../types/mixtapeTypes';

export class MixtapeService {
  private static STORAGE_KEY = 'lumen_mini_mixtapes';
  private static RECEIVED_KEY = 'lumen_received_mixtapes';

  /**
   * Get all user-created mixtapes locally
   */
  public static getCreatedMixtapes(): MiniMixtape[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Save user-created mixtapes locally
   */
  private static saveCreatedMixtapes(tapes: MiniMixtape[]): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(tapes));
    } catch (_) {}
  }

  /**
   * Get received mixtapes
   */
  public static getReceivedMixtapes(): MiniMixtapeShare[] {
    try {
      const raw = localStorage.getItem(this.RECEIVED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Save received mixtapes locally
   */
  public static saveReceivedMixtapes(shares: MiniMixtapeShare[]): void {
    try {
      localStorage.setItem(this.RECEIVED_KEY, JSON.stringify(shares));
    } catch (_) {}
  }

  /**
   * Validate mixtape requirements
   * 3 to 7 tracks required strictly!
   */
  public static validateMixtape(
    title: string,
    tracks: Track[],
    message?: string
  ): { valid: boolean; error?: string } {
    if (!title || title.trim().length === 0) {
      return { valid: false, error: 'Please enter a title for your Mini Mixtape.' };
    }
    if (title.trim().length > 60) {
      return { valid: false, error: 'Mixtape title must be 60 characters or fewer.' };
    }
    if (tracks.length < 3) {
      return { 
        valid: false, 
        error: `Mini Mixtapes require at least 3 tracks (currently has ${tracks.length}).` 
      };
    }
    if (tracks.length > 7) {
      return { 
        valid: false, 
        error: `Mini Mixtapes allow at most 7 tracks (currently has ${tracks.length}).` 
      };
    }
    if (message && message.length > 280) {
      return { valid: false, error: 'Personal note must be 280 characters or fewer.' };
    }
    return { valid: true };
  }

  /**
   * Create and send a Mini Mixtape to one or more friends
   */
  public static async createAndSendMixtape(
    creator: AppUser,
    title: string,
    tracks: Track[],
    recipients: Array<{ uid: string; username: string; displayName: string }>,
    coverStyle: MixtapeCoverStyle = 'mosaic',
    coverPalette: [string, string, string, string] = ['#22d3ee', '#818cf8', '#f43f5e', '#fbbf24'],
    message?: string
  ): Promise<{ success: boolean; mixtape?: MiniMixtape; error?: string }> {
    const val = this.validateMixtape(title, tracks, message);
    if (!val.valid) {
      return { success: false, error: val.error };
    }

    if (recipients.length === 0) {
      return { success: false, error: 'Please select at least one friend to receive this mixtape.' };
    }

    const now = Date.now();
    const mixtapeId = `tape_${now}_${Math.random().toString(36).slice(2, 7)}`;

    const mixtape: MiniMixtape = {
      id: mixtapeId,
      creatorUserId: creator.uid,
      creatorUsername: creator.username || creator.displayName || 'Friend',
      creatorDisplayName: creator.displayName || creator.username || 'Friend',
      title: title.trim(),
      message: message?.trim(),
      coverStyle,
      coverPalette,
      tracks: tracks.map(t => ({
        ...t,
        provider: (t as any).provider || 'saavn',
        providerTrackId: (t as any).providerTrackId || t.id
      })),
      visibility: 'friends',
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    // 1. Save in sender's local collection instantly (0ms)
    const created = this.getCreatedMixtapes();
    this.saveCreatedMixtapes([mixtape, ...created]);

    // 2. Dispatch to each recipient via Firestore shares collection in background (non-blocking instant send)
    const dispatchPromises = recipients.map(async rec => {
      try {
        const db = (FirestoreService as any).getDb?.();
        if (!db) return;
        const shareId = `share_tape_${mixtapeId}_${rec.uid}`;
        const share: MiniMixtapeShare = {
          id: shareId,
          mixtapeId,
          version: 1,
          senderUserId: creator.uid,
          senderUsername: creator.username || creator.displayName || 'Friend',
          senderDisplayName: creator.displayName || creator.username || 'Friend',
          recipientUserId: rec.uid,
          recipientUsername: rec.username,
          message: message?.trim(),
          status: 'sent',
          mixtape,
          sentAt: now,
          openedAt: null
        };
        const shareRef = doc(db, 'shares', shareId);
        await setDoc(shareRef, {
          ...share,
          type: 'mini_mixtape',
          read: false,
          createdAt: now
        }, { merge: true });
      } catch (err) {
        console.warn('[MixtapeService] Background cloud dispatch notice:', err);
      }
    });

    // Run in background without blocking the UI
    Promise.all(dispatchPromises).catch(err => {
      console.warn('[MixtapeService] Background cloud dispatch error:', err);
    });

    return { success: true, mixtape };
  }

  /**
   * Save a received mixtape directly into the user's Lumen library as a custom playlist
   */
  public static saveMixtapeToLibrary(
    mixtape: MiniMixtape,
    user: AppUser
  ): { success: boolean; playlistId?: string } {
    try {
      const coverUrl = mixtape.tracks.find(t => Boolean(t.artworkUrl))?.artworkUrl || null;
      const pl = PlaylistService.createPlaylistWithTracks(
        mixtape.title,
        `Mini Mixtape from @${mixtape.creatorUsername}${mixtape.message ? ` • "${mixtape.message}"` : ''}`,
        coverUrl,
        mixtape.tracks,
        mixtape.coverPalette[0]
      );
      return { success: true, playlistId: pl.id };
    } catch (e: any) {
      console.warn('[MixtapeService] Save to library error:', e);
      return { success: false };
    }
  }

  /**
   * Delete or dismiss a received mixtape
   */
  public static dismissMixtape(shareId: string): void {
    const received = this.getReceivedMixtapes().filter(s => s.id !== shareId && s.mixtape?.id !== shareId);
    this.saveReceivedMixtapes(received);
  }

  /**
   * Delete a user-created mixtape by ID
   */
  public static deleteCreatedMixtape(id: string): void {
    const tapes = this.getCreatedMixtapes().filter(t => t.id !== id);
    this.saveCreatedMixtapes(tapes);
  }

  /**
   * Universal mixtape deletion (removes from created and received collections)
   */
  public static deleteMixtape(id: string): void {
    this.deleteCreatedMixtape(id);
    this.dismissMixtape(id);
  }
}
