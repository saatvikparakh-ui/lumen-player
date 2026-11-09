import { 
  doc, 
  setDoc, 
  onSnapshot, 
  getDoc, 
  deleteDoc, 
  Firestore 
} from 'firebase/firestore';
import { FirestoreService } from './firestoreService';
import { Track } from '../types/music';

export interface BeamedPlaylistPayload {
  name: string;
  description?: string;
  coverUrl?: string | null;
  tracks: Track[];
}

export interface TvBeamSession {
  pin: string;
  status: 'waiting' | 'beamed' | 'consumed';
  createdAt: number;
  playlist?: BeamedPlaylistPayload;
}

export class TvBeamService {
  /**
   * Generates a readable 6-character TV pairing PIN (e.g. LUM-7429)
   */
  public static generatePin(): string {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `LUM-${num}`;
  }

  /**
   * Initializes a TV receiver session. Listens for phone/web transmissions in real time.
   */
  public static startTvSession(
    pin: string,
    onReceived: (payload: BeamedPlaylistPayload) => void
  ): () => void {
    const db = FirestoreService.getDb();
    if (!db) {
      console.warn('[TvBeamService] Firestore database not ready.');
      return () => {};
    }

    const cleanPin = pin.trim().toUpperCase();
    const beamRef = doc(db, 'tvBeams', cleanPin);

    // Create session record
    setDoc(beamRef, {
      pin: cleanPin,
      status: 'waiting',
      createdAt: Date.now()
    }).catch(err => {
      console.warn('[TvBeamService] Failed to create session:', err);
    });

    // Subscribe to incoming beam
    const unsubscribe = onSnapshot(beamRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data() as TvBeamSession;

      if (data && data.status === 'beamed' && data.playlist && data.playlist.tracks) {
        // Acknowledge receipt
        setDoc(beamRef, { status: 'consumed', consumedAt: Date.now() }, { merge: true }).catch(() => {});
        onReceived(data.playlist);
      }
    }, (error) => {
      console.warn('[TvBeamService] Snapshot listener error:', error);
    });

    return () => {
      unsubscribe();
      deleteDoc(beamRef).catch(() => {});
    };
  }

  /**
   * Sends a playlist payload to the TV with the specified PIN from phone/browser.
   */
  public static async beamPlaylistToTv(
    pin: string,
    payload: BeamedPlaylistPayload
  ): Promise<{ success: boolean; error?: string }> {
    const db = FirestoreService.getDb();
    if (!db) {
      return { success: false, error: 'Database service not initialized.' };
    }

    const cleanPin = pin.trim().toUpperCase();
    if (!cleanPin) {
      return { success: false, error: 'Please enter a valid TV PIN.' };
    }

    try {
      const beamRef = doc(db, 'tvBeams', cleanPin);
      const snap = await getDoc(beamRef);

      if (!snap.exists()) {
        return { success: false, error: `TV session "${cleanPin}" not found. Verify the PIN on your TV screen.` };
      }

      // Sanitize tracks before transmission
      const sanitizedTracks = (payload.tracks || []).slice(0, 500).map(t => ({
        id: String(t.id || Date.now() + Math.random()),
        title: String(t.title || 'Untitled Track'),
        artist: String(t.artist || 'Unknown Artist'),
        album: t.album ? String(t.album) : undefined,
        duration: Number(t.duration || 180),
        artworkUrl: t.artworkUrl ? String(t.artworkUrl) : null,
        streamUrl: t.streamUrl ? String(t.streamUrl) : undefined
      }));

      await setDoc(beamRef, {
        status: 'beamed',
        playlist: {
          name: payload.name || 'Beamed Playlist',
          description: payload.description || 'Imported via LUMEN TV Beam',
          coverUrl: payload.coverUrl || null,
          tracks: sanitizedTracks
        },
        beamedAt: Date.now()
      }, { merge: true });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to beam playlist to TV.' };
    }
  }
}
