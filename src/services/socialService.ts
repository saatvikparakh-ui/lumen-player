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
  private livePresenceMap: Record<string, any> = {};

  private listeners = new Set<SocialListener>();
  private alertListeners = new Set<AlertListener>();
  private initializedUserUid: string | null = null;
  private initializedUsername: string | null = null;
  private hasRequestedNotificationPermission = false;
  private hasActionPerformedListener = false;
  private knownRequestIds = new Set<string>();
  private knownShareIds = new Set<string>();
  private handledKeys = new Map<string, number>();

  private getCacheKey(userId: string): string {
    return `lumen_received_shares_${userId}`;
  }

  private getHandledKey(userId: string): string {
    return `lumen_handled_social_keys_${userId}`;
  }

  private getFriendsCacheKey(userId: string): string {
    return `lumen_friends_cache_${userId}`;
  }

  private loadHandledKeys(userId: string): void {
    this.handledKeys.clear();
    try {
      const raw = localStorage.getItem(this.getHandledKey(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const now = Date.now();
      if (parsed && typeof parsed === 'object') {
        for (const [k, ts] of Object.entries(parsed)) {
          // Retain tombstones for 30 days so accepted/dismissed invites never resurrect
          if (typeof ts === 'number' && now - ts < 30 * 24 * 60 * 60 * 1000) {
            this.handledKeys.set(k, ts);
          }
        }
      }
    } catch (_) {}
  }

  private persistHandledKeys(): void {
    if (!this.initializedUserUid) return;
    try {
      const entries = Array.from(this.handledKeys.entries()).slice(-500);
      localStorage.setItem(this.getHandledKey(this.initializedUserUid), JSON.stringify(Object.fromEntries(entries)));
    } catch (_) {}
  }

  public getShareSemanticKeys(item: any): string[] {
    if (!item) return [];
    const keys: string[] = [];
    if (item.id) keys.push(`id:${item.id}`);
    const type = item.type || (item.playlist ? 'playlist' : 'song');
    const sender = String(item.senderId || item.sender_id || item.senderUid || item.senderUsername || item.sender_username || item.inviter_id || item.inviter_name || '').toLowerCase().trim();
    if (type === 'aux_invite') {
      const sid = item.sessionId || item.session_id || item.session?.id;
      if (sid) keys.push(`aux:${sid}`);
      if (sid && sender) keys.push(`aux:${sid}:${sender}`);
    } else if (type === 'album_club_invite') {
      const cid = item.clubId || item.club_id || item.club?.id || item.sessionId;
      if (cid) keys.push(`club:${cid}`);
      if (cid && sender) keys.push(`club:${cid}:${sender}`);
    } else if (type === 'collaborative_tier_list') {
      const tid = item.tierList?.id;
      if (tid) keys.push(`tier:${tid}`);
    }
    return keys;
  }

  public getFriendRequestSemanticKeys(req: any): string[] {
    if (!req) return [];
    const keys: string[] = [];
    if (req.id) keys.push(`freq_id:${req.id}`);
    const fromUid = String(req.fromUid || req.from_uid || '').toLowerCase().trim();
    const fromUser = String(req.fromUsername || req.from_username || '').toLowerCase().replace(/^@/, '').trim();
    if (fromUid) keys.push(`freq_from:${fromUid}`);
    if (fromUser && fromUser !== 'listener') keys.push(`freq_user:${fromUser}`);
    return keys;
  }

  public isShareHandled(item: any): boolean {
    const keys = this.getShareSemanticKeys(item);
    return keys.some(k => this.handledKeys.has(k));
  }

  public isFriendRequestHandled(req: any): boolean {
    const keys = this.getFriendRequestSemanticKeys(req);
    if (keys.some(k => this.handledKeys.has(k))) return true;
    // Also suppress any request from someone who is already a connected friend!
    const fromUid = String(req?.fromUid || req?.from_uid || '').trim();
    if (fromUid && this.friends.some(f => (f.uid || f.userId || f.user_id) === fromUid)) {
      return true;
    }
    return false;
  }

  public markShareHandled(item: any): void {
    const now = Date.now();
    const keys = typeof item === 'string' ? [`id:${item}`] : this.getShareSemanticKeys(item);
    keys.forEach(k => {
      this.handledKeys.set(k, now);
      this.knownShareIds.add(k);
    });
    this.persistHandledKeys();
    const idToRemove = typeof item === 'string' ? item : item?.id;
    const keySet = new Set(keys);
    this.receivedShares = this.receivedShares.filter(s => {
      if (idToRemove && s.id === idToRemove) return false;
      const sKeys = this.getShareSemanticKeys(s);
      return !sKeys.some(k => keySet.has(k));
    });
    if (this.initializedUserUid) {
      this.persistShares(this.initializedUserUid, this.receivedShares);
    }
    this.notifyListeners();
  }

  public markFriendRequestHandled(req: any): void {
    const now = Date.now();
    const keys = typeof req === 'string' ? [`freq_id:${req}`] : this.getFriendRequestSemanticKeys(req);
    keys.forEach(k => {
      this.handledKeys.set(k, now);
      this.knownRequestIds.add(k);
    });
    this.persistHandledKeys();
    const keySet = new Set(keys);
    this.pendingRequests = this.pendingRequests.filter(r => {
      const rKeys = this.getFriendRequestSemanticKeys(r);
      return !rKeys.some(k => keySet.has(k));
    });
    this.notifyListeners();
  }

  public addFriendLocally(friend: {
    uid: string;
    username: string;
    displayName: string;
    photoURL?: string | null;
    markOnline?: boolean;
  }): void {
    if (!friend?.uid) return;
    const exists = this.friends.some(f => (f.uid || f.userId || f.user_id) === friend.uid);
    if (!exists) {
      const normalized: SocialFriend = {
        uid: friend.uid,
        user_id: friend.uid,
        userId: friend.uid,
        username: friend.username || 'friend',
        display_name: friend.displayName || friend.username || 'Friend',
        displayName: friend.displayName || friend.username || 'Friend',
        avatar_url: friend.photoURL || null,
        photoURL: friend.photoURL || null
      };
      this.friends = [normalized, ...this.friends];
      if (this.initializedUserUid) {
        try {
          localStorage.setItem(this.getFriendsCacheKey(this.initializedUserUid), JSON.stringify(this.friends));
        } catch (_) {}
      }
    }
    if (friend.markOnline) {
      this.livePresenceMap[friend.uid] = {
        ...(this.livePresenceMap[friend.uid] || {}),
        userId: friend.uid,
        username: friend.username,
        displayName: friend.displayName,
        photoURL: friend.photoURL || null,
        isPlaying: this.livePresenceMap[friend.uid]?.isPlaying || false,
        updatedAt: Date.now()
      };
    }
    // Automatically clear any pending request from this user now that we're friends
    this.markFriendRequestHandled({ fromUid: friend.uid, fromUsername: friend.username });
    this.notifyListeners();
  }

  public removeFriendLocally(friendUid: string): void {
    this.friends = this.friends.filter(f => (f.uid || f.userId || f.user_id) !== friendUid);
    if (this.initializedUserUid) {
      try {
        localStorage.setItem(this.getFriendsCacheKey(this.initializedUserUid), JSON.stringify(this.friends));
      } catch (_) {}
    }
    this.notifyListeners();
  }

  public getLivePresenceMap(): Record<string, any> {
    return this.livePresenceMap;
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

    // Load persistent tombstone registry FIRST so dismissed/accepted items never resurrect
    this.loadHandledKeys(user.uid);

    // Hydrate cached friends immediately (0ms) so newly accepted friends never vanish on reload
    try {
      const cachedFriends = localStorage.getItem(this.getFriendsCacheKey(user.uid));
      if (cachedFriends) {
        const parsed = JSON.parse(cachedFriends);
        if (Array.isArray(parsed)) this.friends = parsed;
      }
    } catch (_) {}

    // Instantly load cached shares from storage (filtered against tombstones)
    this.receivedShares = this.loadCachedShares(user.uid).filter(s => !this.isShareHandled(s));
    this.receivedShares.forEach(s => {
      this.knownShareIds.add(s.id);
      this.getShareSemanticKeys(s).forEach(k => this.knownShareIds.add(k));
    });
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
      // Announce our online presence right away so friends see us online instantly
      SupabaseService.broadcastPresence({
        userId: user.uid,
        username: nextUsername,
        displayName: user.displayName || `@${nextUsername}`,
        photoURL: user.photoURL || null,
        isPlaying: false,
        updatedAt: Date.now()
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

      const allFetched = [...mappedShares, ...mappedInvites].filter(item => !this.isShareHandled(item));
      if (allFetched.length > 0) {
        const existingMap = new Map(this.receivedShares.map(s => [s.id, s]));
        allFetched.forEach(item => {
          const semKeys = this.getShareSemanticKeys(item);
          const alreadyKnown = semKeys.some(k => this.knownShareIds.has(k));
          if (!existingMap.has(item.id) && !alreadyKnown) {
            existingMap.set(item.id, item);
          }
          this.knownShareIds.add(item.id);
          semKeys.forEach(k => this.knownShareIds.add(k));
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
          if (this.isShareHandled(share)) return;
          const semKeys = this.getShareSemanticKeys(share);
          const isAlreadySeen = this.knownShareIds.has(share.id) || semKeys.some(k => this.knownShareIds.has(k));
          if (!isAlreadySeen) {
            this.knownShareIds.add(share.id);
            semKeys.forEach(k => this.knownShareIds.add(k));
            const senderName = share.sender_display_name || `@${share.sender_username}` || 'A friend';
            const isAux = share.type === 'aux_invite';
            const isTier = share.type === 'collaborative_tier_list';
            const mediaTitle = isAux
              ? `Pass The Aux room "${share.session_title || share.sessionTitle || 'Aux Jam'}"`
              : isTier
                ? `Collaborative Tier List`
                : share.type === 'playlist' && share.playlist
                  ? `playlist "${(share.playlist as any).name || (share.playlist as any).title}"`
                  : `"${share.song?.title || 'a song'}"`;
            const alert: SocialAlert = {
              id: `share_${share.id}`,
              type: 'song_share',
              title: isAux ? 'Pass The Aux Invite' : 'Music Shared With You',
              message: isAux ? `${senderName} invited you to ${mediaTitle}.` : `${senderName} shared ${mediaTitle} with you.`,
              timestamp: Date.now()
            };
            this.dispatchAlert(alert);
            this.triggerLocalNotification(
              isAux ? 'LUMEN • Pass The Aux' : 'LUMEN • Music Shared',
              alert.message
            );

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
              sessionId: share.session_id || share.sessionId,
              sessionTitle: share.session_title || share.sessionTitle,
              sessionMode: share.session_mode,
              session: share.session,
              message: share.message,
              read: share.read,
              createdAt: Date.now()
            } as any;
            this.receivedShares = [mapped, ...this.receivedShares.filter(s => s.id !== share.id)];
            this.persistShares(userId, this.receivedShares);
            this.notifyListeners();
          }
        },
        onAlbumClubInvite: (invite) => {
          if (this.isShareHandled(invite)) return;
          const semKeys = this.getShareSemanticKeys({ ...invite, type: 'album_club_invite' });
          const isAlreadySeen = this.knownShareIds.has(invite.id) || semKeys.some(k => this.knownShareIds.has(k));
          if (!isAlreadySeen) {
            this.knownShareIds.add(invite.id);
            semKeys.forEach(k => this.knownShareIds.add(k));
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
          if (this.isFriendRequestHandled(req)) return;
          const semKeys = this.getFriendRequestSemanticKeys(req);
          const isAlreadySeen = this.knownRequestIds.has(req.id) || semKeys.some(k => this.knownRequestIds.has(k));
          if (!isAlreadySeen) {
            this.knownRequestIds.add(req.id);
            semKeys.forEach(k => this.knownRequestIds.add(k));
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
            this.pendingRequests = [mapped, ...this.pendingRequests.filter(r => r.id !== req.id && r.fromUid !== req.from_uid)];
            this.notifyListeners();
          }
        },
        onFriendAccepted: (payload) => {
          if (!payload || !payload.accepted_by_uid) return;
          const acceptedUid = payload.accepted_by_uid;
          const acceptedUsername = payload.accepted_by_username || 'friend';
          const acceptedDisplayName = payload.accepted_by_display_name || acceptedUsername;

          // Instantly add to global friends list + mark online so Friends Online updates at 0ms!
          this.addFriendLocally({
            uid: acceptedUid,
            username: acceptedUsername,
            displayName: acceptedDisplayName,
            photoURL: payload.accepted_by_photo_url || null,
            markOnline: true
          });

          const alertKey = `accepted_${acceptedUid}`;
          if (!this.knownRequestIds.has(alertKey)) {
            this.knownRequestIds.add(alertKey);
            const alert: SocialAlert = {
              id: `facc_${acceptedUid}_${Date.now()}`,
              type: 'friend_accepted',
              title: 'Friend Request Accepted',
              message: `@${acceptedUsername} accepted your friend request and is now in Friends Online!`,
              timestamp: Date.now()
            };
            this.dispatchAlert(alert);
            this.triggerLocalNotification('LUMEN • New Friend', `@${acceptedUsername} accepted your friend request!`);
          }
        },
        onPresenceUpdate: (presence) => {
          if (!presence?.userId) return;
          this.livePresenceMap[presence.userId] = {
            ...(this.livePresenceMap[presence.userId] || {}),
            ...presence,
            updatedAt: presence.updatedAt || Date.now()
          };
          this.notifyListeners();
        }
      }, username);
    } catch (_) {}

    // 1. Incoming friend requests (Firestore fallback, filtered by tombstones + semantic keys)
    this.unsubRequests = FirestoreService.subscribeToFriendRequests(userId, (requests) => {
      const isInitial = this.knownRequestIds.size === 0 && this.pendingRequests.length === 0;
      const validRequests = (requests || []).filter(r => r.status === 'pending' && !this.isFriendRequestHandled(r));

      // Detect newly arrived requests without duplicating Supabase-delivered ones
      for (const req of validRequests) {
        const semKeys = this.getFriendRequestSemanticKeys(req);
        const alreadySeen = this.knownRequestIds.has(req.id) || semKeys.some(k => this.knownRequestIds.has(k));
        if (!alreadySeen) {
          this.knownRequestIds.add(req.id);
          semKeys.forEach(k => this.knownRequestIds.add(k));
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

      this.pendingRequests = validRequests;
      this.notifyListeners();
    }, username);

    // 2. Incoming song shares (Merged & filtered against tombstones + semantic keys)
    this.unsubShares = FirestoreService.subscribeToReceivedShares(userId, (shares) => {
      const isInitial = this.knownShareIds.size === 0 && this.receivedShares.length === 0;
      const validShares = (shares || []).filter(s => !this.isShareHandled(s));

      for (const share of validShares) {
        const semKeys = this.getShareSemanticKeys(share);
        const alreadySeen = this.knownShareIds.has(share.id) || semKeys.some(k => this.knownShareIds.has(k));
        if (!alreadySeen) {
          this.knownShareIds.add(share.id);
          semKeys.forEach(k => this.knownShareIds.add(k));
          if (!isInitial && !share.read) {
            const senderName = share.senderDisplayName || `@${share.senderUsername}` || 'A friend';
            const isAux = share.type === 'aux_invite';
            const mediaTitle = isAux
              ? `Pass The Aux room "${(share as any).sessionTitle || 'Aux Jam'}"`
              : share.type === 'playlist' && share.playlist
                ? `playlist "${share.playlist.name}"`
                : `"${share.song?.title || 'a song'}"`;
            const alert: SocialAlert = {
              id: `share_${share.id}`,
              type: 'song_share',
              title: isAux ? 'Pass The Aux Invite' : 'Music Shared With You',
              message: isAux ? `${senderName} invited you to ${mediaTitle}.` : `${senderName} shared ${mediaTitle} with you.`,
              timestamp: Date.now()
            };
            this.dispatchAlert(alert);
            this.triggerLocalNotification(
              isAux ? 'LUMEN • Pass The Aux' : 'LUMEN • Music Shared',
              alert.message
            );
          }
        }
      }

      // Merge with existing received shares (deduped by semantic key) while respecting tombstones!
      const existingMap = new Map<string, FirestoreSongShare>();
      const pickKey = (s: FirestoreSongShare) => {
        const ks = this.getShareSemanticKeys(s);
        return ks.length > 1 ? ks[1] : s.id;
      };
      this.receivedShares
        .filter(s => !this.isShareHandled(s))
        .forEach(s => existingMap.set(pickKey(s), s));
      for (const share of validShares) {
        existingMap.set(pickKey(share), share);
      }
      this.receivedShares = Array.from(existingMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      this.persistShares(userId, this.receivedShares);
      this.notifyListeners();
    });

    // 3. Friends list (merge Firestore with any instant Supabase-accepted friends!)
    this.unsubFriends = FirestoreService.subscribeToFriends(userId, (friendsList) => {
      const mergedMap = new Map<string, SocialFriend>();
      // Keep locally accepted friends (e.g. accepted <60s ago via Supabase before Firestore catches up)
      for (const f of this.friends) {
        const fid = f.uid || f.userId || f.user_id;
        if (fid) mergedMap.set(fid, f);
      }
      for (const f of (friendsList as SocialFriend[])) {
        const fid = f.uid || f.userId || f.user_id;
        if (fid) {
          mergedMap.set(fid, {
            ...f,
            uid: fid,
            userId: fid,
            user_id: fid
          });
        }
      }
      this.friends = Array.from(mergedMap.values());
      try {
        localStorage.setItem(this.getFriendsCacheKey(userId), JSON.stringify(this.friends));
      } catch (_) {}
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

  public dismissShareLocally(shareIdOrItem: string | any): void {
    const target = typeof shareIdOrItem === 'string'
      ? (this.receivedShares.find(s => s.id === shareIdOrItem) || shareIdOrItem)
      : shareIdOrItem;
    this.markShareHandled(target);
  }

  public clearAllSharesLocally(): void {
    const now = Date.now();
    this.receivedShares.forEach(s => {
      this.getShareSemanticKeys(s).forEach(k => {
        this.handledKeys.set(k, now);
        this.knownShareIds.add(k);
      });
    });
    this.persistHandledKeys();
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
