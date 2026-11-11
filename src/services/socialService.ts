import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { FirestoreService, FirestoreFriendRequest, FirestoreSongShare } from './firestoreService';
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

  private pendingRequests: FirestoreFriendRequest[] = [];
  private receivedShares: FirestoreSongShare[] = [];
  private friends: SocialFriend[] = [];

  private listeners = new Set<SocialListener>();
  private alertListeners = new Set<AlertListener>();
  private initializedUserUid: string | null = null;
  private initializedUsername: string | null = null;
  private hasRequestedNotificationPermission = false;
  private knownRequestIds = new Set<string>();
  private knownShareIds = new Set<string>();

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

    this.setupListeners(user.uid, nextUsername || undefined);
    this.requestNotificationPermissions();
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
        const notifId = Math.floor(idPrefix + Math.random() * 8000);
        await LocalNotifications.schedule({
          notifications: [
            {
              id: notifId,
              title,
              body,
              channelId: 'lumen_social',
              schedule: { at: new Date(Date.now() + 100) },
              smallIcon: 'ic_stat_icon_config_sample'
            }
          ]
        });
      }
    } catch (_) {}
  }

  private setupListeners(userId: string, username?: string) {
    // 1. Incoming friend requests
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

    // 2. Incoming song shares
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

      this.receivedShares = shares;
      this.notifyListeners();
    });

    // 3. Friends list
    this.unsubFriends = FirestoreService.subscribeToFriends(userId, (friendsList) => {
      this.friends = friendsList as SocialFriend[];
      this.notifyListeners();
    });
  }

  public cleanup() {
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
    this.notifyListeners();
  }

  public clearAllSharesLocally(): void {
    this.receivedShares = [];
    this.notifyListeners();
  }

  public getFriends(): SocialFriend[] {
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
