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

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

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

export const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: "AIzaSyACaCXU0YLsm0cIR0g-jdMI2tjb2oEtYxo",
  authDomain: "songs-1a3c2.firebaseapp.com",
  projectId: "songs-1a3c2",
  storageBucket: "songs-1a3c2.firebasestorage.app",
  messagingSenderId: "551623902315",
  appId: "1:551623902315:web:577493bddfc1a23e95dd2e"
};

class FirebaseAuthServiceClass {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private guestUser: AppUser | null = null;
  private listeners: ((user: AppUser | null) => void)[] = [];

  constructor() {
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

    // Default pre-configured Firebase project for seamless multi-device login
    return DEFAULT_FIREBASE_CONFIG;
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

          this.notifyListeners(appUser);
          this.syncWithBackend(appUser);
        } else if (!this.guestUser) {
          this.notifyListeners(null);
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
      if (this.guestUser && this.guestUser.uid === targetUid) {
        this.guestUser.hasCompletedOnboarding = status;
        localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(this.guestUser));
        this.notifyListeners(this.guestUser);
      }
    } catch (_) {}
  }

  public async signInWithEmail(email: string, pass: string): Promise<AppUser> {
    if (!this.auth) {
      throw new Error('Firebase Auth is not configured. Please add your Firebase configuration.');
    }
    const cred = await signInWithEmailAndPassword(this.auth, email, pass);
    const u = cred.user;
    return {
      uid: u.uid,
      email: u.email,
      displayName: u.displayName || email.split('@')[0],
      photoURL: u.photoURL,
      isGuest: false,
      hasCompletedOnboarding: this.getOnboardingStatus(u.uid)
    };
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
    return appUser;
  }

  public async signInWithGoogle(): Promise<AppUser> {
    if (!this.auth) {
      throw new Error('Firebase Auth is not configured. Please add your Firebase configuration.');
    }
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(this.auth, provider);
    const u = cred.user;
    return {
      uid: u.uid,
      email: u.email,
      displayName: u.displayName || u.email?.split('@')[0] || 'Google User',
      photoURL: u.photoURL,
      isGuest: false,
      hasCompletedOnboarding: this.getOnboardingStatus(u.uid)
    };
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

    this.guestUser = guest;
    try {
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guest));
    } catch (_) {}

    this.notifyListeners(guest);
    this.syncWithBackend(guest);
    return guest;
  }

  public async signOut(): Promise<void> {
    this.guestUser = null;
    try {
      localStorage.removeItem(GUEST_STORAGE_KEY);
    } catch (_) {}

    if (this.auth) {
      try {
        await fbSignOut(this.auth);
      } catch (_) {}
    }
    this.notifyListeners(null);
  }

  public getCurrentUser(): AppUser | null {
    if (this.guestUser) return this.guestUser;
    if (this.auth?.currentUser) {
      const u = this.auth.currentUser;
      return {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName || u.email?.split('@')[0] || 'Listener',
        photoURL: u.photoURL,
        isGuest: false,
        hasCompletedOnboarding: this.getOnboardingStatus(u.uid)
      };
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
      fetch('/api/friends/profile', {
        headers: { 'x-user-id': user.uid }
      }).catch(() => {});
    } catch (_) {}
  }
}

export const FirebaseAuthService = new FirebaseAuthServiceClass();
