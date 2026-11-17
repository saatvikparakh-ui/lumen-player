import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { FirestoreService, FirestoreFriendRequest, FirestoreSongShare } from './firestoreService';
import { SupabaseService } from './supabaseService';
import { AlbumClubService } from './albumClubService';
import { AppUser } from './firebaseAuthService';

export interface SocialFriend {
  uid: string;
  user_id: string;
  userId: string;
  username: string;
  display_name: string;
  displayName: string;
  avatar_url?: string | null;
  photoURL?: string | null;
}

export interface SocialAlert {
  id: string;
  type: 'friend_request' | 'song_share' | 'friend_accepted';
  title: string;
  message: string;
  timestamp: number;
}

type SocialListener = () => void;
type AlertListener = (alert: SocialAlert) => void;

class SocialServiceClass {
  private currentUser: AppUser | null = null;
  private unsubRequests: (() => void) | null = null;
  private unsubShares: (() => void) | null = null;
  private unsubFriends: (() => void) | null = null;
  private unsubSupabase: (() => void) | null = null;

  private pendingRequests: FirestoreFriendRequest[] = [];
  private receivedShares: FirestoreSongShare[] = [];
  private friends: SocialFriend[] = [];

  private listeners = new Set<SocialListener>();
  private alertListeners = new Set<AlertListener>();
  private initializedUserUid: string | null = null;
  private initializedUsername: string | null = null;
  private hasRequestedNotificationPermission = false;
  private hasActionPerformedListener = false;
  private knownRequestIds = new Set<string>();
  private knownShareIds = new Set<string>();

  private getCacheKey(userId: string): string {
    return `lumen_received_shares_${userId}`;
  }

  private loadCachedShares(userId: string): FirestoreSongShare[] {
    try {
      const raw = localStorage.getItem(this.getCacheKey(userId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  private persistShares(userId: string, shares: FirestoreSongShare[]): void {
    try {
      localStorage.setItem(this.getCacheKey(userId), JSON.stringify(shares.slice(0, 50)));
    } catch (_) {}
  }

  /**
   * Start application-level social listeners for the logged-in user.
   * Can be called whenever auth state changes.
   */
  public init(user: AppUser | null) {
    if (!user || (!user.uid && !user.username)) {
      this.cleanup();
      this.currentUser = null;
      this.initializedUserUid = null;
      this.initializedUsername = null;
      this.notifyListeners();
      return;
    }

    const nextUsername = user.username || null;
    if (this.initializedUserUid === user.uid && this.initializedUsername === nextUsername) {
      this.currentUser = user;
      return;
    }

    this.cleanup();
    this.currentUser = user;
    this.initializedUserUid = user.uid;
    this.initializedUsername = nextUsername;

    // Instantly load cached shares from storage so user sees them without latency
    this.receivedShares = this.loadCachedShares(user.uid);
    this.receivedShares.forEach(s => this.knownShareIds.add(s.id));
    this.notifyListeners();

    this.setupListeners(user.uid, nextUsername || undefined);
    this.requestNotificationPermissions();

    if (nextUsername) {
      SupabaseService.announceUser({
        id: user.uid,
        username: nextUsername,
        displayName: user.displayName || `@${nextUsername}`,
        photoURL: user.photoURL
      });
    }
  }

  /**
   * Request Android 13+ POST_NOTIFICATIONS permission
   */
  public async requestNotificationPermissions() {
    if (this.hasRequestedNotificationPermission) return;
    this.hasRequestedNotificationPermission = true;

    try {
      if (Capacitor.isNativePlatform()) {
        const status = await LocalNotifications.checkPermissions();
        if (status.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }

        // Create Lumen Social notification channel on Android
        try {
          await LocalNotifications.createChannel({
            id: 'lumen_social',
            name: 'LUMEN Social',
            description: 'Friend requests and music shared with you',
            importance: 4,
            visibility: 1,
            vibration: true
          });
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[SocialService] Notification permission check error:', e);
    }
  }

  private async triggerLocalNotification(title: string, body: string, idPrefix = 1000) {
    try {
      if (Capacitor.isNativePlatform()) {
        if (!this.hasActionPerformedListener) {
          this.hasActionPerformedListener = true;
          try {
            LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
              console.log('[SocialService] Notification clicked, opening Friends tab:', notificationAction);
              window.dispatchEvent(new CustomEvent('lumen:navigate', { detail: { view: 'friends' } }));
            });
          } catch (_) {}
        }

        const notifId = Math.floor(idPrefix + Math.random() * 8000);
        await LocalNotifications.schedule({
          notifications: [
            {
              id: notifId,
              title,
              body,
              channelId: 'lumen_social',
              schedule: { at: new Date(Date.now() + 100) },
              smallIcon: 'ic_stat_lumen',
              iconColor: '#22D3EE'
            }
          ]
        });
      }
    } catch (_) {}
  }

  private setupListeners(userId: string, username?: string) {
    // 0. Fetch existing persistent shares & invites from Supabase
    Promise.all([
      SupabaseService.getReceivedShares(userId, username),
      SupabaseService.getAlbumClubInvites(userId, username)
    ]).then(([supaShares, supaInvites]) => {
      const mappedShares: FirestoreSongShare[] = supaShares.map(share => ({
        id: share.id,
        senderId: share.sender_id,
        senderUsername: share.sender_username,
        senderDisplayName: share.sender_display_name,
        recipientId: share.recipient_id,
        recipientUsername: share.recipient_username,
        type: (share.type as any) || 'song',
        song: share.song,
        playlist: share.playlist,
        message: share.message,
        read: share.read,
        createdAt: share.created_at ? new Date(share.created_at).getTime() : Date.now()
      }));

      const mappedInvites: FirestoreSongShare[] = supaInvites.map(invite => ({
        id: invite.id,
        senderId: invite.inviter_id,
        senderUsername: invite.inviter_name,
        senderDisplayName: invite.inviter_name,
        recipientId: invite.invitee_id,
        recipientUsername: invite.invitee_name,
        type: 'album_club_invite' as any,
        message: `Invited you to Album Club "${invite.club_name}"`,
        sessionId: invite.club_id,
        sessionTitle: invite.club_name,
        clubId: invite.club_id,
        clubName: invite.club_name,
        read: false,
        createdAt: invite.created_at ? new Date(invite.created_at).getTime() : Date.now()
      }));

      const allFetched = [...mappedShares, ...mappedInvites];
      if (allFetched.length > 0) {
        const existingMap = new Map(this.receivedShares.map(s => [s.id, s]));
        allFetched.forEach(item => {
          if (!existingMap.has(item.id)) {
            existingMap.set(item.id, item);
            this.knownShareIds.add(item.id);
          }
        });
        this.receivedShares = Array.from(existingMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        this.persistShares(userId, this.receivedShares);
        this.notifyListeners();
      }
    }).catch(err => console.warn('[SocialService] Supabase initial shares fetch notice:', err));

    // 0b. High-speed Supabase Realtime personal channel (<50ms WebSocket push)
    try {
      this.unsubSupabase = SupabaseService.subscribeToUserChannel(userId, {
        onSongShare: (share) => {
          if (!this.knownShareIds.has(share.id)) {
            this.knownShareIds.add(share.id);
            const senderName = share.sender_display_name || `@${share.sender_username}` || 'A friend';
            const mediaTitle = share.type === 'playlist' && share.playlist
              ? `playlist "${(share.playlist as any).name || (share.playlist as any).title}"`
              : `"${share.song?.title || 'a song'}"`;
            const alert: SocialAlert = {
              id: `share_${share.id}`,
              type: 'song_share',
              title: 'Music Shared With You',
              message: `${senderName} shared ${mediaTitle} with you.`,
              timestamp: Date.now()
            };
            this.dispatchAlert(alert);
            this.triggerLocalNotification('LUMEN • Music Shared', `${senderName} shared ${mediaTitle} with you!`);

            const mapped: FirestoreSongShare = {
              id: share.id,
              senderId: share.sender_id,
              senderUsername: share.sender_username,
              senderDisplayName: share.sender_display_name,
              recipientId: share.recipient_id,
              recipientUsername: share.recipient_username,
              type: (share.type as any) || 'song',
              song: share.song,
              playlist: share.playlist,
              message: share.message,
              read: share.read,
              createdAt: Date.now()
            };
            this.receivedShares = [mapped, ...this.receivedShares.filter(s => s.id !== share.id)];
            this.persistShares(userId, this.receivedShares);
            this.notifyListeners();
          }
        },
        onAlbumClubInvite: (invite) => {
          if (!this.knownShareIds.has(invite.id)) {
            this.knownShareIds.add(invite.id);
            const alert: SocialAlert = {
              id: `club_inv_${invite.id}`,
              type: 'song_share',
              title: 'Album Club Invitation',
              message: `${invite.inviter_name} invited you to join "${invite.club_name}"`,
              timestamp: Date.now()
            };
            this.dispatchAlert(alert);
            this.triggerLocalNotification('LUMEN • Album Club', `${invite.inviter_name} invited you to join "${invite.club_name}"!`);

            if (invite.club) {
              AlbumClubService.saveClub(invite.club);
            }

            const mapped: FirestoreSongShare = {
              id: invite.id,
              senderId: invite.inviter_id,
              senderUsername: invite.inviter_name,
              senderDisplayName: invite.inviter_name,
              recipientId: invite.invitee_id,
              recipientUsername: invite.invitee_name,
              type: 'album_club_invite' as any,
              message: `Invited you to Album Club "${invite.club_name}"`,
              sessionId: invite.club_id,
              sessionTitle: invite.club_name,
              clubId: invite.club_id,
              clubName: invite.club_name,
              club: invite.club,
              read: false,
              createdAt: Date.now()
            };
            this.receivedShares = [mapped, ...this.receivedShares.filter(s => s.id !== invite.id)];
            this.persistShares(userId, this.receivedShares);
            this.notifyListeners();
          }
        },
        onFriendRequest: (req) => {
          if (!this.knownRequestIds.has(req.id)) {
            this.knownRequestIds.add(req.id);
            const senderName = req.from_display_name || `@${req.from_username}` || 'A listener';
            const alert: SocialAlert = {
              id: `req_${req.id}`,
              type: 'friend_request',
              title: 'New Friend Request',
              message: `${senderName} wants to connect with you on LUMEN.`,
              timestamp: Date.now()
            };
            this.dispatchAlert(alert);
            this.triggerLocalNotification('LUMEN • Friend Request', `${senderName} wants to connect!`);

            const mapped: FirestoreFriendRequest = {
              id: req.id,
              fromUid: req.from_uid,
              fromUsername: req.from_username,
              fromDisplayName: req.from_display_name,
              fromPhotoURL: req.from_photo_url || null,
              toUid: req.to_uid,
              status: req.status || 'pending',
              createdAt: Date.now()
            };
            this.pendingRequests = [mapped, ...this.pendingRequests.filter(r => r.id !== req.id)];
            this.notifyListeners();
          }
        }
      }, username);
    } catch (_) {}

    // 1. Incoming friend requests (Firestore fallback)
    this.unsubRequests = FirestoreService.subscribeToFriendRequests(userId, (requests) => {
      const isInitial = this.knownRequestIds.size === 0 && this.pendingRequests.length === 0;
      
      // Detect newly arrived requests
      for (const req of requests) {
        if (!this.knownRequestIds.has(req.id)) {
          this.knownRequestIds.add(req.id);
          if (!isInitial) {
            const senderName = req.fromDisplayName || `@${req.fromUsername}` || 'A listener';
            const alert: SocialAlert = {
              id: `req_${req.id}`,
              type: 'friend_request',
              title: 'New Friend Request',
              message: `${senderName} sent you a friend request on LUMEN.`,
              timestamp: Date.now()
            };
            this.dispatchAlert(alert);
            this.triggerLocalNotification('LUMEN • New Friend Request', `${senderName} wants to connect with you!`);
          }
        }
      }

      this.pendingRequests = requests;
      this.notifyListeners();
    }, username);

    // 2. Incoming song shares (Merged to prevent wiping out Supabase shares)
    this.unsubShares = FirestoreService.subscribeToReceivedShares(userId, (shares) => {
      const isInitial = this.knownShareIds.size === 0 && this.receivedShares.length === 0;

      for (const share of shares) {
        if (!this.knownShareIds.has(share.id)) {
          this.knownShareIds.add(share.id);
          if (!isInitial && !share.read) {
            const senderName = share.senderDisplayName || `@${share.senderUsername}` || 'A friend';
            const mediaTitle = share.type === 'playlist' && share.playlist
              ? `playlist "${share.playlist.name}"`
              : `"${share.song?.title || 'a song'}"`;
            const alert: SocialAlert = {
              id: `share_${share.id}`,
              type: 'song_share',
              title: 'Music Shared With You',
              message: `${senderName} shared ${mediaTitle} with you.`,
              timestamp: Date.now()
            };
            this.dispatchAlert(alert);
            this.triggerLocalNotification('LUMEN • Music Shared', `${senderName} shared ${mediaTitle} with you!`);
          }
        }
      }

      // Merge with existing received shares (deduped by ID) so empty Firestore snapshots never clear Supabase shares!
      const existingMap = new Map(this.receivedShares.map(s => [s.id, s]));
      for (const share of shares) {
        existingMap.set(share.id, share);
      }
      this.receivedShares = Array.from(existingMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      this.persistShares(userId, this.receivedShares);
      this.notifyListeners();
    });

    // 3. Friends list
    this.unsubFriends = FirestoreService.subscribeToFriends(userId, (friendsList) => {
      this.friends = friendsList as SocialFriend[];
      this.notifyListeners();
    });
  }

  public cleanup() {
    if (this.unsubSupabase) {
      this.unsubSupabase();
      this.unsubSupabase = null;
    }
    if (this.unsubRequests) {
      this.unsubRequests();
      this.unsubRequests = null;
    }
    if (this.unsubShares) {
      this.unsubShares();
      this.unsubShares = null;
    }
    if (this.unsubFriends) {
      this.unsubFriends();
      this.unsubFriends = null;
    }
    this.pendingRequests = [];
    this.receivedShares = [];
    this.friends = [];
    this.knownRequestIds.clear();
    this.knownShareIds.clear();
  }

  // Getters
  public getPendingRequests(): FirestoreFriendRequest[] {
    return this.pendingRequests;
  }

  public getReceivedShares(): FirestoreSongShare[] {
    return this.receivedShares;
  }

  public dismissShareLocally(shareId: string): void {
    this.receivedShares = this.receivedShares.filter(s => s.id !== shareId);
    if (this.initializedUserUid) {
      this.persistShares(this.initializedUserUid, this.receivedShares);
    }
    this.notifyListeners();
  }

  public clearAllSharesLocally(): void {
    this.receivedShares = [];
    if (this.initializedUserUid) {
      this.persistShares(this.initializedUserUid, []);
    }
    this.notifyListeners();
  }

  public getFriends(): SocialFriend[] {
    if (this.friends.length === 0 && this.currentUser?.uid) {
      try {
        const cached = localStorage.getItem(`lumen_friends_cache_${this.currentUser.uid}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.friends = parsed;
          }
        }
      } catch (_) {}
    }
    return this.friends;
  }

  public getUnreadCount(): number {
    const pendingCount = this.pendingRequests.length;
    const unreadShareCount = this.receivedShares.filter(s => !s.read).length;
    return pendingCount + unreadShareCount;
  }

  // Subscriptions
  public subscribe(listener: SocialListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onAlert(listener: AlertListener): () => void {
    this.alertListeners.add(listener);
    return () => {
      this.alertListeners.delete(listener);
    };
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.warn('[SocialService] Listener error:', err);
      }
    }
  }

  private dispatchAlert(alert: SocialAlert) {
    for (const listener of this.alertListeners) {
      try {
        listener(alert);
      } catch (err) {
        console.warn('[SocialService] Alert listener error:', err);
      }
    }
  }
}

export const SocialService = new SocialServiceClass();
