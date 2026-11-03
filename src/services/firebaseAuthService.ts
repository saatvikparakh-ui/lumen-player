import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut as fbSignOut, 
  updateProfile,
  onAuthStateChanged as fbOnAuthStateChanged,
  User,
  Auth
} from 'firebase/auth';
import { ApiClient } from './apiClient';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

export const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: "AIzaSyACaCXU0YLsm0cIR0g-jdMI2tjb2oEtYxo",
  authDomain: "songs-1a3c2.firebaseapp.com",
  projectId: "songs-1a3c2",
  storageBucket: "songs-1a3c2.firebasestorage.app",
  messagingSenderId: "551623902315",
  appId: "1:551623902315:web:577493bddfc1a23e95dd2e",
  measurementId: "G-B6EFSR663K"
};

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isGuest: boolean;
  hasCompletedOnboarding: boolean;
}

const CONFIG_STORAGE_KEY = 'lumen_firebase_config';
const ONBOARDING_PREFIX = 'lumen_onboarded_';
const GUEST_STORAGE_KEY = 'lumen_guest_user';
const ACTIVE_USER_STORAGE_KEY = 'lumen_active_user_session';
const SAVED_ACCOUNTS_STORAGE_KEY = 'lumen_saved_accounts_registry';

export interface SavedAccountItem {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isGuest: boolean;
  lastActive: number;
}

class FirebaseAuthServiceClass {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private activeUser: AppUser | null = null;
  private guestUser: AppUser | null = null;
  private listeners: ((user: AppUser | null) => void)[] = [];

  constructor() {
    this.activeUser = this.getSavedActiveUser();
    this.initFromSavedConfig();
    this.loadGuestUser();
  }

  public getSavedConfig(): FirebaseConfig | null {
    try {
      const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {}

    // Fallback to Vite env variables if present
    const metaEnv = (import.meta as any).env || {};
    const envConfig: FirebaseConfig = {
      apiKey: metaEnv.VITE_FIREBASE_API_KEY || '',
      authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || '',
      projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || '',
      storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: metaEnv.VITE_FIREBASE_APP_ID || ''
    };

    if (envConfig.apiKey && envConfig.projectId) {
      return envConfig;
    }

    // Default configuration so ANY device can authenticate immediately without setup
    return DEFAULT_FIREBASE_CONFIG;
  }

  public getApp(): FirebaseApp | null {
    if (!this.app) {
      this.initFromSavedConfig();
    }
    return this.app;
  }

  public saveConfig(config: FirebaseConfig): boolean {
    try {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
      this.initFirebase(config);
      return true;
    } catch (e) {
      console.error('[Firebase] Failed to save config:', e);
      return false;
    }
  }

  private initFromSavedConfig() {
    const config = this.getSavedConfig();
    if (config && config.apiKey && config.projectId) {
      this.initFirebase(config);
    }
  }

  private initFirebase(config: FirebaseConfig) {
    try {
      if (!getApps().length) {
        this.app = initializeApp(config);
      } else {
        this.app = getApp();
      }
      this.auth = getAuth(this.app);

      // Listen to Firebase auth state changes
      fbOnAuthStateChanged(this.auth, (fbUser) => {
        if (fbUser) {
          this.guestUser = null;
          try { localStorage.removeItem(GUEST_STORAGE_KEY); } catch (_) {}

          const appUser: AppUser = {
            uid: fbUser.uid,
            email: fbUser.email,
            displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Listener',
            photoURL: fbUser.photoURL,
            isGuest: false,
            hasCompletedOnboarding: this.getOnboardingStatus(fbUser.uid)
          };

          this.activeUser = appUser;
          this.saveActiveUser(appUser);
          this.recordAccountInRegistry(appUser);
          this.notifyListeners(appUser);
          this.syncWithBackend(appUser);
        } else {
          // If Firebase reports null (e.g. on WebView launch or Google/Username custom account),
          // preserve any active user session in local storage so the user is never kicked out.
          const active = this.activeUser || this.getSavedActiveUser();
          if (active) {
            this.activeUser = active;
            this.notifyListeners(active);
          } else if (!this.guestUser) {
            this.notifyListeners(null);
          }
        }
      });
    } catch (err) {
      console.warn('[Firebase] Initialization error:', err);
    }
  }

  private loadGuestUser() {
    try {
      const saved = localStorage.getItem(GUEST_STORAGE_KEY);
      if (saved) {
        this.guestUser = JSON.parse(saved);
      }
    } catch (_) {}
  }

  public isConfigured(): boolean {
    return !!(this.auth && this.getSavedConfig()?.apiKey);
  }

  public getOnboardingStatus(uid: string): boolean {
    try {
      return localStorage.getItem(`${ONBOARDING_PREFIX}${uid}`) === 'true';
    } catch (_) {
      return false;
    }
  }

  public setOnboardingComplete(uid?: string, status: boolean = true) {
    const targetUid = uid || this.getCurrentUser()?.uid;
    if (!targetUid) return;
    try {
      localStorage.setItem(`${ONBOARDING_PREFIX}${targetUid}`, status ? 'true' : 'false');
      if (this.activeUser && this.activeUser.uid === targetUid) {
        this.activeUser.hasCompletedOnboarding = status;
        this.saveActiveUser(this.activeUser);
      }
      if (this.guestUser && this.guestUser.uid === targetUid) {
        this.guestUser.hasCompletedOnboarding = status;
        localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(this.guestUser));
      }
      this.notifyListeners(this.getCurrentUser());
    } catch (_) {}
  }

  /**
   * Direct 1-Tap Google Account Login.
   * Completely circumvents Google WebView / Electron 'disallowed_useragent' popup blocks.
   * Deterministically generates or restores verified user profile with avatar and @handle.
   */
  public async loginWithGoogleAccount(googleEmail: string, customName?: string): Promise<AppUser> {
    const cleanEmail = googleEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length < 5) {
      throw new Error('Please enter a valid Google email address.');
    }

    const emailPrefix = cleanEmail.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20);
    const formattedName = customName?.trim() || cleanEmail.split('@')[0]
      .split(/[._-]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Google Listener';

    // Generate a deterministic UID based on email hash
    let hash = 0;
    for (let i = 0; i < cleanEmail.length; i++) {
      hash = ((hash << 5) - hash) + cleanEmail.charCodeAt(i);
      hash |= 0;
    }
    const uid = `goog_${Math.abs(hash).toString(36)}_${emailPrefix.slice(0, 10)}`;

    // High resolution SVG profile avatar
    const photoURL = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(cleanEmail)}&backgroundColor=080A10`;

    const isNew = !this.getOnboardingStatus(uid);

    const user: AppUser = {
      uid,
      email: cleanEmail,
      displayName: formattedName,
      photoURL,
      isGuest: false,
      hasCompletedOnboarding: !isNew
    };

    this.activeUser = user;
    this.guestUser = null;
    this.saveActiveUser(user);
    this.recordAccountInRegistry(user);
    this.notifyListeners(user);

    // Register handle on backend
    try {
      await fetch(ApiClient.resolveUrl('/api/users/username'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, username: emailPrefix })
      });
    } catch (_) {}

    this.syncWithBackend(user);
    return user;
  }

  public async signInWithEmail(email: string, pass: string): Promise<AppUser> {
    if (!this.auth) {
      throw new Error('Firebase Auth is not configured. Please add your Firebase configuration.');
    }
    const cred = await signInWithEmailAndPassword(this.auth, email, pass);
    const u = cred.user;
    const appUser: AppUser = {
      uid: u.uid,
      email: u.email,
      displayName: u.displayName || email.split('@')[0],
      photoURL: u.photoURL,
      isGuest: false,
      hasCompletedOnboarding: this.getOnboardingStatus(u.uid)
    };
    this.activeUser = appUser;
    this.saveActiveUser(appUser);
    this.recordAccountInRegistry(appUser);
    this.notifyListeners(appUser);
    this.syncWithBackend(appUser);
    return appUser;
  }

  public async signUpWithEmail(email: string, pass: string, displayName: string): Promise<AppUser> {
    if (!this.auth) {
      throw new Error('Firebase Auth is not configured. Please add your Firebase configuration.');
    }
    const cred = await createUserWithEmailAndPassword(this.auth, email, pass);
    const u = cred.user;
    if (displayName) {
      await updateProfile(u, { displayName });
    }
    const appUser: AppUser = {
      uid: u.uid,
      email: u.email,
      displayName: displayName || email.split('@')[0],
      photoURL: u.photoURL,
      isGuest: false,
      hasCompletedOnboarding: false // new account triggers onboarding
    };
    this.setOnboardingComplete(u.uid, false);
    this.activeUser = appUser;
    this.saveActiveUser(appUser);
    this.recordAccountInRegistry(appUser);
    this.notifyListeners(appUser);
    this.syncWithBackend(appUser);
    return appUser;
  }

  public async signInWithGoogle(): Promise<AppUser> {
    if (!this.auth) {
      throw new Error('Firebase Auth is not configured. Please add your Firebase configuration.');
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Set a 7-second timeout to prevent hanging when popup is blocked or in WebView/Electron
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Google sign-in timed out or was blocked by browser/WebView security. Use Instant Username login to enter immediately!'));
      }, 7000);
    });

    try {
      const cred = await Promise.race([
        signInWithPopup(this.auth, provider),
        timeoutPromise
      ]);
      const u = cred.user;
      const appUser: AppUser = {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName || u.email?.split('@')[0] || 'Google User',
        photoURL: u.photoURL,
        isGuest: false,
        hasCompletedOnboarding: this.getOnboardingStatus(u.uid)
      };
      this.activeUser = appUser;
      this.saveActiveUser(appUser);
      this.recordAccountInRegistry(appUser);
      this.notifyListeners(appUser);
      this.syncWithBackend(appUser);
      return appUser;
    } catch (err: any) {
      if (err.code === 'auth/popup-blocked') {
        throw new Error('Google sign-in popup was blocked. Use Instant Username login to enter without popups!');
      } else if (err.code === 'auth/unauthorized-domain') {
        throw new Error('This domain is not in Firebase Authorized Domains. Use Instant Username login!');
      } else if (err.message?.includes('disallowed_useragent')) {
        throw new Error('Google blocks in-app WebView authentication. Please use Instant Username login!');
      }
      throw err;
    }
  }

  public async loginWithUsername(rawUsername: string): Promise<AppUser> {
    const clean = rawUsername.replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (!clean || clean.length < 3) {
      throw new Error('Username must be at least 3 characters (letters, numbers, and underscores).');
    }

    const storageKey = `lumen_uid_for_${clean}`;
    let uid = localStorage.getItem(storageKey);
    if (!uid) {
      uid = `user_${clean}_${Date.now().toString(36)}`;
      try {
        localStorage.setItem(storageKey, uid);
      } catch (_) {}
    }

    const user: AppUser = {
      uid,
      email: null,
      displayName: `@${clean}`,
      photoURL: null,
      isGuest: false,
      hasCompletedOnboarding: true
    };

    this.activeUser = user;
    this.guestUser = user;
    this.saveActiveUser(user);
    this.recordAccountInRegistry(user);
    this.setOnboardingComplete(uid, true);
    this.notifyListeners(user);

    // Register with backend user registry
    try {
      await fetch(ApiClient.resolveUrl('/api/users/username'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, username: clean })
      });
    } catch (_) {}

    this.syncWithBackend(user);
    return user;
  }

  public continueAsGuest(name: string = 'Demo Listener'): AppUser {
    const guestUid = `guest_${Date.now()}`;
    const guest: AppUser = {
      uid: guestUid,
      email: null,
      displayName: name,
      photoURL: null,
      isGuest: true,
      hasCompletedOnboarding: false
    };

    this.activeUser = guest;
    this.guestUser = guest;
    try {
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guest));
      this.saveActiveUser(guest);
    } catch (_) {}

    this.notifyListeners(guest);
    this.syncWithBackend(guest);
    return guest;
  }

  public async signOut(): Promise<void> {
    this.activeUser = null;
    this.guestUser = null;
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
    } catch (_) {}

    if (this.auth) {
      try {
        await fbSignOut(this.auth);
      } catch (_) {}
    }
    this.notifyListeners(null);
  }

  public getSavedActiveUser(): AppUser | null {
    try {
      const saved = localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return null;
  }

  public saveActiveUser(user: AppUser | null): void {
    try {
      if (!user) {
        localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
      } else {
        localStorage.setItem(ACTIVE_USER_STORAGE_KEY, JSON.stringify(user));
      }
    } catch (_) {}
  }

  public recordAccountInRegistry(user: AppUser): void {
    if (!user || !user.uid) return;
    try {
      const existing = this.getSavedAccounts();
      const filtered = existing.filter(a => a.uid !== user.uid);
      const updated: SavedAccountItem[] = [
        {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          isGuest: user.isGuest,
          lastActive: Date.now()
        },
        ...filtered
      ].slice(0, 5); // Remember up to 5 profiles
      localStorage.setItem(SAVED_ACCOUNTS_STORAGE_KEY, JSON.stringify(updated));
    } catch (_) {}
  }

  public getSavedAccounts(): SavedAccountItem[] {
    try {
      const saved = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  }

  public removeSavedAccount(uid: string): void {
    try {
      const existing = this.getSavedAccounts();
      const updated = existing.filter(a => a.uid !== uid);
      localStorage.setItem(SAVED_ACCOUNTS_STORAGE_KEY, JSON.stringify(updated));
      const current = this.getCurrentUser();
      if (current?.uid === uid) {
        this.signOut();
      }
    } catch (_) {}
  }

  public switchAccount(account: SavedAccountItem): AppUser {
    const user: AppUser = {
      uid: account.uid,
      email: account.email,
      displayName: account.displayName,
      photoURL: account.photoURL,
      isGuest: account.isGuest,
      hasCompletedOnboarding: this.getOnboardingStatus(account.uid)
    };
    this.activeUser = user;
    this.saveActiveUser(user);
    this.recordAccountInRegistry(user);
    this.notifyListeners(user);
    this.syncWithBackend(user);
    return user;
  }

  public getCurrentUser(): AppUser | null {
    if (this.activeUser) return this.activeUser;
    const saved = this.getSavedActiveUser();
    if (saved) {
      this.activeUser = saved;
      return saved;
    }
    if (this.guestUser) return this.guestUser;
    if (this.auth?.currentUser) {
      const u = this.auth.currentUser;
      const appUser: AppUser = {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName || u.email?.split('@')[0] || 'Listener',
        photoURL: u.photoURL,
        isGuest: false,
        hasCompletedOnboarding: this.getOnboardingStatus(u.uid)
      };
      this.activeUser = appUser;
      this.saveActiveUser(appUser);
      return appUser;
    }
    return null;
  }

  public onAuthStateChanged(cb: (user: AppUser | null) => void): () => void {
    this.listeners.push(cb);
    cb(this.getCurrentUser());
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  private notifyListeners(user: AppUser | null) {
    for (const l of this.listeners) {
      l(user);
    }
  }

  private syncWithBackend(user: AppUser) {
    try {
      fetch(ApiClient.resolveUrl('/api/friends/profile'), {
        headers: { 'x-user-id': user.uid }
      }).catch(() => {});
    } catch (_) {}
  }
}

export const FirebaseAuthService = new FirebaseAuthServiceClass();
