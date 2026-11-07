import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut as fbSignOut, 
  updateProfile,
  onAuthStateChanged as fbOnAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInAnonymously,
  linkWithCredential,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  deleteUser,
  User,
  Auth
} from 'firebase/auth';
import { PlaylistService } from './playlistService';
import { LikedService } from './likedService';
import { RatingAndStatsService } from './ratingAndStatsService';
import { FirestoreService } from './firestoreService';

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
  emailVerified: boolean;
  username?: string | null;
  hasCompletedOnboarding: boolean;
}

export interface AuthState {
  user: AppUser | null;
  isAnonymous: boolean;
  emailVerified: boolean;
  authReady: boolean;
}

const CONFIG_STORAGE_KEY = 'lumen_firebase_config';
const ONBOARDING_PREFIX = 'lumen_onboarded_';
const RECENT_EMAILS_KEY = 'lumen_recent_emails_hint';

class FirebaseAuthServiceClass {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private currentUser: AppUser | null = null;
  private isAuthReady: boolean = false;
  private listeners: ((user: AppUser | null) => void)[] = [];
  private authStateListeners: ((state: AuthState) => void)[] = [];

  constructor() {
    this.initFromSavedConfig();
  }

  public getSavedConfig(): FirebaseConfig | null {
    try {
      const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {}

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

      // Explicit local persistence: IndexedDB first, with local storage fallback
      try {
        this.auth = initializeAuth(this.app, {
          persistence: [indexedDBLocalPersistence, browserLocalPersistence]
        });
      } catch (_) {
        this.auth = getAuth(this.app);
      }

      // Single authoritative identity stream directly from Firebase Auth
      fbOnAuthStateChanged(this.auth, async (fbUser: User | null) => {
        if (fbUser) {
          let username: string | null = null;
          try {
            const prof = await FirestoreService.getUserProfile(fbUser.uid);
            username = prof?.username || null;
          } catch (_) {}

          const resolvedName = fbUser.displayName || (username ? `@${username}` : (fbUser.email ? fbUser.email.split('@')[0] : 'Listener'));
          const resolvedPhoto = fbUser.photoURL || (username ? `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username)}&backgroundColor=080A10` : null);

          const appUser: AppUser = {
            uid: fbUser.uid,
            email: fbUser.email,
            displayName: resolvedName,
            photoURL: resolvedPhoto,
            isGuest: fbUser.isAnonymous,
            emailVerified: fbUser.emailVerified,
            username,
            hasCompletedOnboarding: this.getOnboardingStatus(fbUser.uid)
          };

          this.currentUser = appUser;
          this.isAuthReady = true;

          if (fbUser.email) {
            this.recordRecentEmail(fbUser.email);
          }

          this.notifyListeners(appUser);
        } else {
          this.currentUser = null;
          this.isAuthReady = true;
          this.notifyListeners(null);
        }
      });
    } catch (err) {
      console.warn('[Firebase] Initialization error:', err);
      this.isAuthReady = true;
    }
  }

  private getAuthInstance(): Auth {
    if (!this.auth) {
      this.initFromSavedConfig();
    }
    if (!this.auth) {
      throw new Error('Firebase Auth is not initialized. Please verify your configuration.');
    }
    return this.auth;
  }

  public isReady(): boolean {
    return this.isAuthReady;
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
    const targetUid = uid || this.currentUser?.uid;
    if (!targetUid) return;
    try {
      localStorage.setItem(`${ONBOARDING_PREFIX}${targetUid}`, status ? 'true' : 'false');
      if (this.currentUser && this.currentUser.uid === targetUid) {
        this.currentUser.hasCompletedOnboarding = status;
      }
      this.notifyListeners(this.currentUser);
    } catch (_) {}
  }

  /**
   * Maps Firebase auth error codes to clean, secure user messages.
   * Does NOT leak email existence on sign-in or reset.
   */
  public static formatAuthError(err: any): string {
    if (!err) return 'An unexpected error occurred. Please try again.';
    const code = String(err.code || '');
    const message = String(err.message || '');

    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || message.includes('invalid-credential')) {
      return 'Incorrect email or password.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'This email address is already registered. Please sign in instead.';
    }
    if (code === 'auth/weak-password') {
      return 'Password must be at least 8 characters.';
    }
    if (code === 'auth/invalid-email') {
      return 'Please enter a valid email address.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many attempts. Please wait a few moments and try again.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Network connection issue. Please check your internet connection.';
    }
    if (code === 'auth/popup-blocked') {
      return 'Sign-in popup was blocked by browser. Please allow popups or use email & password.';
    }
    if (code === 'auth/requires-recent-login') {
      return 'This sensitive action requires recent authentication. Please sign in again.';
    }
    if (code === 'auth/credential-already-in-use') {
      return 'This email is already associated with another account. Please sign in to that account.';
    }
    return message || 'Authentication failed. Please try again.';
  }

  /**
   * Register with Email and Password.
   * If current session is an anonymous guest, links credential to preserve UID and all cloud data!
   */
  public async signUp(params: {
    email: string;
    password: string;
    displayName?: string;
    username: string;
  }): Promise<AppUser> {
    const auth = this.getAuthInstance();
    const cleanEmail = (params.email || '').trim().toLowerCase();
    const cleanPass = params.password || '';
    const cleanUser = (params.username || '').replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }
    if (cleanPass.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
    if (!cleanUser || cleanUser.length < 3) {
      throw new Error('Username must be at least 3 characters (letters, numbers, underscores).');
    }

    // Pre-validate username availability
    const isTaken = await FirestoreService.isUsernameTaken(cleanUser);
    if (isTaken) {
      throw new Error(`@${cleanUser} is already taken. Please choose another username.`);
    }

    let userCred: any;
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      try {
        const credential = EmailAuthProvider.credential(cleanEmail, cleanPass);
        userCred = await linkWithCredential(auth.currentUser, credential);
      } catch (linkErr: any) {
        if (linkErr.code === 'auth/credential-already-in-use') {
          throw new Error('This email is already registered. Please sign in instead.');
        }
        userCred = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPass);
      }
    } else {
      userCred = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPass);
    }

    const fbUser = userCred.user;
    const finalDisplayName = params.displayName?.trim() || `@${cleanUser}`;
    const avatarUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(cleanUser)}&backgroundColor=080A10`;

    try {
      await updateProfile(fbUser, {
        displayName: finalDisplayName,
        photoURL: avatarUrl
      });
    } catch (_) {}

    // Claim username and create profile documents atomically
    await FirestoreService.claimUsernameAndCreateProfile(
      fbUser.uid,
      cleanUser,
      finalDisplayName,
      cleanEmail,
      avatarUrl
    );

    // Send verification email
    try {
      await sendEmailVerification(fbUser);
    } catch (e) {
      console.warn('[FirebaseAuth] Verification email notice:', e);
    }

    const appUser: AppUser = {
      uid: fbUser.uid,
      email: cleanEmail,
      displayName: finalDisplayName,
      photoURL: avatarUrl,
      isGuest: false,
      emailVerified: fbUser.emailVerified,
      username: cleanUser,
      hasCompletedOnboarding: false
    };

    this.currentUser = appUser;
    this.recordRecentEmail(cleanEmail);
    this.notifyListeners(appUser);
    return appUser;
  }

  /**
   * Sign In with Email and Password.
   */
  public async signIn(email: string, pass: string): Promise<AppUser> {
    const auth = this.getAuthInstance();
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }
    if (!pass) {
      throw new Error('Please enter your password.');
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, pass);
      const fbUser = cred.user;

      let username: string | null = null;
      try {
        const prof = await FirestoreService.getUserProfile(fbUser.uid);
        username = prof?.username || null;
      } catch (_) {}

      const appUser: AppUser = {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName || (username ? `@${username}` : fbUser.email?.split('@')[0] || 'Listener'),
        photoURL: fbUser.photoURL,
        isGuest: false,
        emailVerified: fbUser.emailVerified,
        username,
        hasCompletedOnboarding: this.getOnboardingStatus(fbUser.uid)
      };

      this.currentUser = appUser;
      this.recordRecentEmail(cleanEmail);
      this.notifyListeners(appUser);
      return appUser;
    } catch (err: any) {
      throw new Error(FirebaseAuthServiceClass.formatAuthError(err));
    }
  }

  /**
   * Google 1-Tap Sign-In via Firebase Auth popup.
   */
  public async signInWithGoogle(): Promise<AppUser> {
    const auth = this.getAuthInstance();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      const cred = await signInWithPopup(auth, provider);
      const fbUser = cred.user;

      let username: string | null = null;
      try {
        const prof = await FirestoreService.getUserProfile(fbUser.uid);
        username = prof?.username || null;
        if (!username && fbUser.email) {
          const candidate = fbUser.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
          const isTaken = await FirestoreService.isUsernameTaken(candidate);
          if (!isTaken) {
            await FirestoreService.claimUsernameAndCreateProfile(
              fbUser.uid,
              candidate,
              fbUser.displayName || `@${candidate}`,
              fbUser.email,
              fbUser.photoURL || null
            );
            username = candidate;
          }
        }
      } catch (_) {}

      const appUser: AppUser = {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName || (username ? `@${username}` : fbUser.email?.split('@')[0] || 'Google User'),
        photoURL: fbUser.photoURL,
        isGuest: false,
        emailVerified: fbUser.emailVerified,
        username,
        hasCompletedOnboarding: this.getOnboardingStatus(fbUser.uid)
      };

      this.currentUser = appUser;
      if (fbUser.email) {
        this.recordRecentEmail(fbUser.email);
      }
      this.notifyListeners(appUser);
      return appUser;
    } catch (err: any) {
      throw new Error(FirebaseAuthServiceClass.formatAuthError(err));
    }
  }

  /**
   * Password reset email. Does not reveal whether the email exists.
   */
  public async sendPasswordReset(email: string): Promise<string> {
    const auth = this.getAuthInstance();
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
    } catch (err: any) {
      if (err.code !== 'auth/user-not-found' && err.code !== 'auth/invalid-email') {
        console.warn('[FirebaseAuth] Password reset notice:', err);
      }
    }
    return 'If an account exists for this email, password reset instructions have been sent.';
  }

  public async sendVerificationEmail(): Promise<void> {
    const auth = this.getAuthInstance();
    if (!auth.currentUser) throw new Error('No user is currently signed in.');
    await sendEmailVerification(auth.currentUser);
  }

  public async reauthenticate(password: string): Promise<void> {
    const auth = this.getAuthInstance();
    const u = auth.currentUser;
    if (!u || !u.email) throw new Error('No user is signed in to reauthenticate.');
    const cred = EmailAuthProvider.credential(u.email, password);
    await reauthenticateWithCredential(u, cred);
  }

  public async changePassword(oldPass: string, newPass: string): Promise<void> {
    if (newPass.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }
    await this.reauthenticate(oldPass);
    const auth = this.getAuthInstance();
    if (auth.currentUser) {
      await updatePassword(auth.currentUser, newPass);
    }
  }

  public async updateDisplayName(name: string): Promise<void> {
    const auth = this.getAuthInstance();
    const u = auth.currentUser;
    if (!u) throw new Error('No user is currently signed in.');
    const clean = name.trim();
    await updateProfile(u, { displayName: clean });
    await FirestoreService.saveUserProfile(u.uid, { displayName: clean });
    if (this.currentUser) {
      this.currentUser = { ...this.currentUser, displayName: clean };
      this.notifyListeners(this.currentUser);
    }
  }

  public async deleteAccount(password: string): Promise<void> {
    await this.reauthenticate(password);
    const auth = this.getAuthInstance();
    const u = auth.currentUser;
    if (!u) return;
    const uid = u.uid;
    await FirestoreService.deleteUserData(uid);
    await deleteUser(u);
    await this.signOut({ clearLocalData: true });
  }

  /**
   * Free Firebase Anonymous Auth for guests.
   * Gives the guest an authoritative uid for security rules and sync!
   */
  public async continueAsGuest(): Promise<AppUser> {
    const auth = this.getAuthInstance();
    const cred = await signInAnonymously(auth);
    const u = cred.user;
    const guestUser: AppUser = {
      uid: u.uid,
      email: null,
      displayName: 'Guest Listener',
      photoURL: null,
      isGuest: true,
      emailVerified: false,
      hasCompletedOnboarding: false
    };
    this.currentUser = guestUser;
    this.notifyListeners(guestUser);
    return guestUser;
  }

  public async signOut(options?: { clearLocalData?: boolean }): Promise<void> {
    const uid = this.currentUser?.uid;

    if (options?.clearLocalData && uid) {
      try {
        localStorage.removeItem(`lumen:playlists:${uid}`);
        localStorage.removeItem(`lumen:likes:${uid}`);
        localStorage.removeItem(`lumen:ratings:${uid}`);
        localStorage.removeItem(`lumen:settings:${uid}`);
        localStorage.removeItem(`lumen_last_played_${uid}`);
        localStorage.removeItem(`lumen_playlists_${uid}`);
        localStorage.removeItem(`lumen_liked_songs_${uid}`);
        localStorage.removeItem(`lumen_ratings_${uid}`);
      } catch (_) {}
    }

    this.currentUser = null;

    if (this.auth) {
      try {
        await fbSignOut(this.auth);
      } catch (_) {}
    }

    this.notifyListeners(null);
  }

  public getCurrentUser(): AppUser | null {
    return this.currentUser;
  }

  public getAuthState(): AuthState {
    return {
      user: this.currentUser,
      isAnonymous: !!(this.currentUser?.isGuest),
      emailVerified: !!(this.currentUser?.emailVerified),
      authReady: this.isAuthReady
    };
  }

  public onAuthStateChanged(cb: (user: AppUser | null) => void): () => void {
    this.listeners.push(cb);
    if (this.isAuthReady) {
      cb(this.currentUser);
    }
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  public onFullAuthState(cb: (state: AuthState) => void): () => void {
    this.authStateListeners.push(cb);
    cb(this.getAuthState());
    return () => {
      this.authStateListeners = this.authStateListeners.filter(l => l !== cb);
    };
  }

  private notifyListeners(user: AppUser | null) {
    const isRealUser = !!(user && !user.isGuest);
    const targetUid = user?.uid || null;

    PlaylistService.initForUser(targetUid, !isRealUser).catch(() => {});
    LikedService.initForUser(targetUid, !isRealUser).catch(() => {});
    RatingAndStatsService.setUserId(targetUid || '', user?.displayName || undefined);

    for (const l of this.listeners) {
      try {
        l(user);
      } catch (err) {
        console.error('Auth listener error:', err);
      }
    }

    const state = this.getAuthState();
    for (const al of this.authStateListeners) {
      try {
        al(state);
      } catch (_) {}
    }
  }

  // Non-authoritative recent email hints for typing convenience only
  public recordRecentEmail(email: string): void {
    if (!email || !email.includes('@')) return;
    try {
      const recents = this.getRecentEmails();
      const updated = [email, ...recents.filter(e => e !== email)].slice(0, 5);
      localStorage.setItem(RECENT_EMAILS_KEY, JSON.stringify(updated));
    } catch (_) {}
  }

  public getRecentEmails(): string[] {
    try {
      const saved = localStorage.getItem(RECENT_EMAILS_KEY);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [];
  }

  public clearRecentEmails(): void {
    try {
      localStorage.removeItem(RECENT_EMAILS_KEY);
    } catch (_) {}
  }
}

export const FirebaseAuthService = new FirebaseAuthServiceClass();
