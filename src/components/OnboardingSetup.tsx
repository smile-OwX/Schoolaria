import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Archive,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Globe,
  GraduationCap,
  KeyRound,
  Link2,
  LogOut,
  MailCheck,
  Phone,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  auth,
  completeDesktopBrowserPopup,
  formatFirebaseAuthError,
  getLinkedProviders,
  isCompiledShell,
  isElectronDesktop,
  linkGoogleAccountToCurrentUser,
  registerWithPhonePassword,
  reloadCurrentUser,
  resendVerificationEmail,
  sendPasswordReset,
  signInWithDesktopToken,
  signInWithGoogle,
  signInWithPhoneOrEmailPassword,
  signOutUser,
} from '../lib/firebase.ts';
import {
  COUNTRY_DIAL_CODES,
  formatAuthIdentifierForDisplay,
  phoneToAuthEmail,
  resolveIdentifierToAuthEmail,
} from '../lib/phoneAuth.ts';
import {
  getApiBaseUrl,
  getSavedApiBaseUrl,
  setSavedApiBaseUrl,
} from '../lib/apiClient.ts';
import {
  SchoolUniformTheme,
  applySchoolThemeToDocument,
  getSavedPreviewTheme,
  normalizeSchoolTheme,
  savePreviewTheme,
} from '../lib/schoolTheme.ts';
import { SchoolProfile } from '../types/school.ts';
import { PWAInstallButton } from './PWAInstallBanner.tsx';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { ConfirmModal } from './ConfirmModal.tsx';
import { UniformThemePicker } from './UniformThemePicker.tsx';

interface DesktopBridgeWindow extends Window {
  schoolariaDesktop?: {
    platform?: string;
    startSystemBrowserAuth?: () => Promise<{ opened: boolean }>;
    onDesktopAuthToken?: (
      cb: (payload: { idToken: string | null; accessToken: string | null }) => void
    ) => () => void;
  };
}

interface AuthGateProps {
  pendingVerificationUser?: User | null;
  onSuccess?: () => void;
  onVerificationComplete?: (user: User) => void;
}

export function DesktopBrowserAuthBridge({ nonce }: { nonce: string }) {
  const [loading, setLoading] = useState(false);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAuthorize = async () => {
    setLoading(true);
    setError(null);
    try {
      const { idToken, accessToken, email } = await completeDesktopBrowserPopup();
      const resp = await fetch('/__desktop_auth_callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, idToken, accessToken }),
      });
      if (!resp.ok) {
        const errData = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          errData.error || "Impossible de renvoyer la session vers l'application Schoolaria PC."
        );
      }
      setDoneEmail(email || 'votre compte Google');
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // Ignore browser tab close restrictions
        }
      }, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : formatFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
      <div className="max-w-md w-full bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl overflow-hidden shadow-xl">
        <div className="theme-surface-header p-6 flex items-center gap-3 border-b">
          <div className="w-11 h-11 rounded-xl theme-nav-active flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold">Schoolaria</h1>
            <p className="text-xs theme-header-subtext">Validation sécurisée du compte Google</p>
          </div>
        </div>

        <div className="p-8">
          {doneEmail ? (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold theme-text-ink">Connexion réussie !</h2>
              <p className="text-sm text-zinc-600">
                Session validée pour <strong>{doneEmail}</strong>. Vous pouvez fermer cet onglet et retourner dans l’application <strong>Schoolaria</strong>.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-bold theme-text-ink mb-2">
                Finaliser la connexion
              </h2>
              <p className="text-sm text-zinc-600 leading-relaxed mb-6">
                Sélectionnez votre compte Google dans votre navigateur pour connecter instantanément Schoolaria.
              </p>

              {error && (
                <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 leading-relaxed">
                  {error}
                </div>
              )}

              <button
                onClick={handleAuthorize}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 theme-btn-primary rounded-xl text-sm font-semibold transition-all shadow-xs disabled:opacity-60"
              >
                {loading ? 'Validation Google en cours...' : 'Choisir mon compte Google'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuthGate({
  pendingVerificationUser = null,
  onSuccess,
  onVerificationComplete,
}: AuthGateProps) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [countryCode, setCountryCode] = useState('228');
  const [fullName, setFullName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<SchoolUniformTheme>(() => getSavedPreviewTheme());

  const [loading, setLoading] = useState(false);
  const [browserNotice, setBrowserNotice] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    applySchoolThemeToDocument(previewTheme);
  }, [previewTheme]);

  const compiledShell = isCompiledShell();
  const isDesktopApp = isElectronDesktop();
  const desktopBridge =
    typeof window !== 'undefined'
      ? (window as DesktopBridgeWindow).schoolariaDesktop
      : undefined;
  const hasSystemBrowserAuth =
    isDesktopApp && typeof desktopBridge?.startSystemBrowserAuth === 'function';

  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(() => getSavedApiBaseUrl() || getApiBaseUrl());
  const [serverSaved, setServerSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopBridge?.onDesktopAuthToken) return;
    const unsub = desktopBridge.onDesktopAuthToken(async ({ idToken, accessToken }) => {
      setLoading(true);
      setError(null);
      setBrowserNotice(null);
      try {
        await signInWithDesktopToken(idToken, accessToken);
        onSuccess?.();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : formatFirebaseAuthError(err));
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [desktopBridge, onSuccess]);

  useEffect(() => {
    if (!pendingVerificationUser) return;
    let active = true;
    const checkVerifiedSilently = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const updated = await reloadCurrentUser();
        if (active && updated?.emailVerified) {
          onVerificationComplete?.(updated);
          onSuccess?.();
        }
      } catch {
        // Ignore silent check errors; manual button remains available
      }
    };
    window.addEventListener('focus', checkVerifiedSilently);
    document.addEventListener('visibilitychange', checkVerifiedSilently);
    return () => {
      active = false;
      window.removeEventListener('focus', checkVerifiedSilently);
      document.removeEventListener('visibilitychange', checkVerifiedSilently);
    };
  }, [pendingVerificationUser, onVerificationComplete, onSuccess]);

  const handleSimpleGoogleLogin = async () => {
    setError(null);
    setSuccessNotice(null);
    setBrowserNotice(null);
    if (hasSystemBrowserAuth && desktopBridge?.startSystemBrowserAuth) {
      setBrowserNotice(
        'Votre navigateur Chrome / Edge vient de s’ouvrir. Choisissez votre compte Google puis revenez ici.'
      );
      try {
        await desktopBridge.startSystemBrowserAuth();
      } catch (err: unknown) {
        setBrowserNotice(null);
        setError(
          err instanceof Error
            ? err.message
            : "Impossible d'ouvrir votre navigateur par défaut."
        );
      }
      return;
    }

    setLoading(true);
    try {
      await signInWithGoogle();
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : formatFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    setBrowserNotice(null);

    if (authMode === 'register') {
      if (fullName.trim().length < 2) {
        setError('Veuillez indiquer votre nom complet (au moins 2 caractères).');
        return;
      }
      if (!phoneToAuthEmail(identifier, countryCode)) {
        setError('Veuillez saisir un numéro de téléphone valide (ex : 90 12 34 56).');
        return;
      }
      if (password.length < 6) {
        setError('Le mot de passe doit contenir au moins 6 caractères.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Les deux mots de passe ne correspondent pas.');
        return;
      }
    } else {
      if (!identifier.trim() || !password) {
        setError('Veuillez saisir votre numéro de téléphone (ou e-mail) et votre mot de passe.');
        return;
      }
      const resolved = resolveIdentifierToAuthEmail(identifier, countryCode);
      if (!resolved.authEmail) {
        setError('Numéro de téléphone ou e-mail invalide. Exemple : 90 12 34 56.');
        return;
      }
    }

    setLoading(true);
    try {
      if (authMode === 'register') {
        const createdUser = await registerWithPhonePassword(
          fullName,
          identifier,
          password,
          countryCode
        );
        onVerificationComplete?.(createdUser);
        onSuccess?.();
      } else {
        const { user } = await signInWithPhoneOrEmailPassword(
          identifier,
          password,
          countryCode
        );
        if (user.emailVerified || !user.email?.includes('@') || user.email.endsWith('@tel.schoolaria.app')) {
          onVerificationComplete?.(user);
          onSuccess?.();
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : formatFirebaseAuthError(err, 'phone'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const cleanInput = identifier.trim();
    if (!cleanInput) {
      setError('Saisissez d’abord votre identifiant ci-dessus.');
      return;
    }
    if (!cleanInput.includes('@')) {
      setError(
        'Les comptes créés par numéro de téléphone n’ont pas d’e-mail de récupération. Contactez la direction de votre établissement en cas d’oubli.'
      );
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessNotice(null);
    try {
      await sendPasswordReset(cleanInput);
      setSuccessNotice(`Lien de réinitialisation envoyé à ${cleanInput.toLowerCase()}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : formatFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCheckEmailVerified = async () => {
    setLoading(true);
    setError(null);
    setSuccessNotice(null);
    try {
      const updated = await reloadCurrentUser();
      if (updated?.emailVerified) {
        onVerificationComplete?.(updated);
        onSuccess?.();
      } else {
        setError(
          'Votre e-mail n’est pas encore confirmé. Ouvrez le message reçu (vérifiez aussi les spams), cliquez sur le lien puis réessayez.'
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Vérification impossible pour le moment.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    setError(null);
    setSuccessNotice(null);
    try {
      await resendVerificationEmail();
      setSuccessNotice(
        `Nouvel e-mail de vérification envoyé à ${pendingVerificationUser?.email || 'votre adresse'}.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Envoi impossible pour le moment.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveServerUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = setSavedApiBaseUrl(serverUrlInput);
    setServerUrlInput(saved);
    setServerSaved(
      saved
        ? `Serveur Vercel enregistré : ${saved}`
        : 'URL personnalisée effacée.'
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative z-10">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl overflow-hidden shadow-xl"
      >
        <div className="theme-surface-header px-6 py-5 flex items-center gap-3 border-b">
          <div className="w-11 h-11 rounded-xl theme-nav-active flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold">Schoolaria</h1>
            <p className="text-xs theme-header-subtext">Direction · Censeur · Secrétaire · Enseignants · Parents</p>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {pendingVerificationUser ? (
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-2xl theme-pill-soft border flex items-center justify-center">
                <MailCheck className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold theme-text-ink">
                  Vérifiez votre adresse e-mail
                </h2>
                <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed mt-1">
                  Pour sécuriser l’accès aux dossiers et bulletins scolaires, confirmez l’adresse{' '}
                  <strong className="theme-text-ink">{pendingVerificationUser.email}</strong> via le lien envoyé dans votre boîte mail.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 leading-relaxed">
                  {error}
                </div>
              )}
              {successNotice && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 leading-relaxed">
                  {successNotice}
                </div>
              )}

              <button
                type="button"
                onClick={handleCheckEmailVerified}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl theme-btn-primary text-sm font-bold transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>J’ai vérifié mon e-mail · Continuer</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={loading}
                  className="px-3 py-2 rounded-xl border theme-pill-soft text-xs font-semibold transition-colors disabled:opacity-60"
                >
                  Renvoyer l’e-mail
                </button>
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 hover:bg-zinc-50 text-xs font-semibold text-zinc-700 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Changer de compte
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Primary Connexion / Inscription Switch */}
              <div
                role="tablist"
                aria-label="Mode d'accès"
                className="grid grid-cols-2 gap-1.5 p-1 rounded-xl theme-pill-soft border mb-4"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === 'login'}
                  onClick={() => {
                    setAuthMode('login');
                    setPassword('');
                    setConfirmPassword('');
                    setError(null);
                    setSuccessNotice(null);
                    setBrowserNotice(null);
                  }}
                  className={`min-h-[42px] py-2 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${
                    authMode === 'login'
                      ? 'theme-btn-primary shadow-xs'
                      : 'theme-text-ink hover:bg-white/60'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5 shrink-0" />
                  <span>Se connecter</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === 'register'}
                  onClick={() => {
                    setAuthMode('register');
                    if (identifier.includes('@')) setIdentifier('');
                    setPassword('');
                    setConfirmPassword('');
                    setError(null);
                    setSuccessNotice(null);
                    setBrowserNotice(null);
                  }}
                  className={`min-h-[42px] py-2 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${
                    authMode === 'register'
                      ? 'theme-btn-primary shadow-xs'
                      : 'theme-text-ink hover:bg-white/60'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>S’inscrire</span>
                </button>
              </div>

              <h2 className="text-lg font-bold theme-text-ink mb-1 text-balance">
                {authMode === 'login'
                  ? 'Connexion à votre espace'
                  : 'Créer un compte Schoolaria'}
              </h2>
              <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed mb-4">
                {authMode === 'login'
                  ? 'Connectez-vous avec Google ou par numéro de téléphone et mot de passe.'
                  : 'Inscrivez-vous avec Google, ou sans compte e-mail avec votre numéro, nom et mot de passe.'}
              </p>

              {error && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 leading-relaxed"
                >
                  {error}
                </div>
              )}
              {successNotice && (
                <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 leading-relaxed">
                  {successNotice}
                </div>
              )}
              {browserNotice && (
                <div className="mb-4 p-3 rounded-xl theme-pill-soft border text-xs leading-relaxed">
                  {browserNotice}
                </div>
              )}

              {/* Option 1 : Google (1 clic pour connexion ou inscription) */}
              <button
                type="button"
                onClick={handleSimpleGoogleLogin}
                disabled={loading}
                className="w-full min-h-[44px] flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-zinc-50 border border-zinc-300 rounded-xl text-sm font-semibold text-zinc-800 transition-all shadow-xs active:scale-[0.99] disabled:opacity-60 whitespace-nowrap"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                <span>
                  {loading
                    ? 'Connexion en cours...'
                    : authMode === 'register'
                    ? hasSystemBrowserAuth
                      ? 'S’inscrire avec Google (Chrome / Edge)'
                      : 'S’inscrire avec Google'
                    : hasSystemBrowserAuth
                    ? 'Se connecter avec Google (Chrome / Edge)'
                    : 'Se connecter avec Google'}
                </span>
              </button>

              <div className="my-3.5 flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200" />
                <span className="text-[11px] font-semibold theme-text-accent whitespace-nowrap">
                  ou sans compte Google
                </span>
                <div className="h-px flex-1 bg-zinc-200" />
              </div>

              {/* Option 2 : Numéro, Nom et Mot de passe (sans e-mail requis) */}
              <form onSubmit={handleCredentialSubmit} className="space-y-3">
                {authMode === 'register' && (
                  <div>
                    <label
                      htmlFor="auth-fullname"
                      className="block text-[11px] font-semibold text-zinc-700 mb-1"
                    >
                      Nom complet *
                    </label>
                    <input
                      id="auth-fullname"
                      type="text"
                      required
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ex : Mme Afiwa Mensah"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="auth-phone-or-id"
                    className="block text-[11px] font-semibold text-zinc-700 mb-1"
                  >
                    {authMode === 'register'
                      ? 'Numéro de téléphone *'
                      : 'Numéro de téléphone (ou e-mail) *'}
                  </label>
                  <div className="flex gap-2">
                    <select
                      aria-label="Indicatif pays"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="w-[112px] sm:w-[124px] shrink-0 px-2.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 theme-input outline-none text-xs font-semibold text-zinc-800"
                    >
                      {COUNTRY_DIAL_CODES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.flag} +{c.code}
                        </option>
                      ))}
                    </select>
                    <div className="relative flex-1 min-w-0">
                      <Phone className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="auth-phone-or-id"
                        type={authMode === 'register' ? 'tel' : 'text'}
                        inputMode={authMode === 'register' ? 'tel' : 'text'}
                        required
                        autoComplete={authMode === 'register' ? 'tel' : 'username'}
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder={
                          authMode === 'register'
                            ? '90 12 34 56'
                            : '90 12 34 56 ou e-mail'
                        }
                        className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm font-mono-nums"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="auth-password"
                      className="text-[11px] font-semibold text-zinc-700"
                    >
                      Mot de passe *
                    </label>
                    {authMode === 'login' && (
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="text-[11px] font-semibold theme-text-accent hover:underline"
                      >
                        Mot de passe oublié ?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={authMode === 'register' ? 'Minimum 6 caractères' : 'Votre mot de passe'}
                      className="w-full pl-3.5 pr-11 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                      className="no-ripple absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {authMode === 'register' && (
                  <div>
                    <label
                      htmlFor="auth-confirm-password"
                      className="block text-[11px] font-semibold text-zinc-700 mb-1"
                    >
                      Confirmer le mot de passe *
                    </label>
                    <div className="relative">
                      <input
                        id="auth-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Retapez le mot de passe"
                        className="w-full pl-3.5 pr-11 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        aria-label={showConfirmPassword ? 'Masquer la confirmation' : 'Afficher la confirmation'}
                        className="no-ripple absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl theme-btn-primary text-sm font-bold transition-all shadow-xs disabled:opacity-60 whitespace-nowrap"
                >
                  {authMode === 'register' ? (
                    <UserPlus className="w-4 h-4 shrink-0" />
                  ) : (
                    <KeyRound className="w-4 h-4 shrink-0" />
                  )}
                  <span>
                    {loading
                      ? authMode === 'register'
                        ? 'Création du compte...'
                        : 'Connexion...'
                      : authMode === 'register'
                      ? 'Créer mon compte'
                      : 'Se connecter'}
                  </span>
                </button>

                <p className="text-[11px] text-zinc-500 leading-relaxed pt-0.5">
                  {authMode === 'register'
                    ? 'Aucun compte e-mail requis : votre numéro de téléphone et votre mot de passe suffisent.'
                    : 'Pas encore de compte ? Cliquez sur « S’inscrire » ci-dessus (Google ou numéro de téléphone).'}
                </p>
              </form>
            </>
          )}

          {compiledShell && (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => setShowServerConfig((v) => !v)}
                className="text-xs font-semibold theme-text-accent hover:underline flex items-center gap-1.5"
              >
                <Globe className="w-3.5 h-3.5" />
                {showServerConfig ? 'Masquer la config serveur Vercel' : 'Configurer l’URL du serveur Vercel / Node.js'}
              </button>
              {showServerConfig && (
                <form onSubmit={handleSaveServerUrl} className="mt-2.5 p-3 rounded-xl theme-pill-soft border space-y-2">
                  <input
                    type="url"
                    value={serverUrlInput}
                    onChange={(e) => setServerUrlInput(e.target.value)}
                    placeholder="https://mon-ecole.vercel.app"
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs outline-none theme-input"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] truncate ${getApiBaseUrl() ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {serverSaved || (getApiBaseUrl() ? `Serveur : ${getApiBaseUrl()}` : 'Aucune URL Vercel enregistrée')}
                    </span>
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-lg theme-btn-primary text-xs font-semibold shrink-0"
                    >
                      Enregistrer
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="mt-4 pt-3.5 border-t theme-border-soft space-y-3">
            <UniformThemePicker
              variant="compact"
              value={previewTheme}
              onChange={(nextTheme) => {
                setPreviewTheme(nextTheme);
                savePreviewTheme(nextTheme);
              }}
              label="Thème uniforme"
            />
            <div className="flex items-center justify-between gap-2 text-xs theme-text-accent">
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Accès cloisonné par rôle et établissement.</span>
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export interface SchoolFormValues {
  schoolName: string;
  adminName: string;
  academicYear: string;
  endOfYearDate?: string;
  motto?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  registrationCode?: string;
  theme?: SchoolUniformTheme;
}

interface SchoolSetupProps {
  defaultAdminName: string;
  initialValues?: SchoolFormValues;
  isEdit?: boolean;
  isOwner?: boolean;
  cancelLabel?: string;
  schoolSnapshot?: SchoolProfile;
  onExportBackup?: () => void;
  onOpenYearTransition?: () => void;
  onOpenArchives?: () => void;
  onDeleteSchool?: () => Promise<void>;
  onCancel?: () => void;
  onSubmit: (values: SchoolFormValues) => Promise<void>;
}

export function SchoolSetupForm({
  defaultAdminName,
  initialValues,
  isEdit = false,
  isOwner = false,
  cancelLabel,
  onExportBackup,
  onOpenYearTransition,
  onOpenArchives,
  onDeleteSchool,
  onCancel,
  onSubmit,
}: SchoolSetupProps) {
  const { isStandalone } = usePWAInstall();
  const compiledShell = isCompiledShell();
  const [schoolName, setSchoolName] = useState(initialValues?.schoolName ?? '');
  const [adminName, setAdminName] = useState(initialValues?.adminName ?? defaultAdminName);
  const [academicYear, setAcademicYear] = useState(initialValues?.academicYear ?? '2026-2027');
  const [endOfYearDate, setEndOfYearDate] = useState(initialValues?.endOfYearDate ?? '2027-06-30');
  const [motto, setMotto] = useState(initialValues?.motto ?? 'Travail · Discipline · Succès');
  const [phone, setPhone] = useState(initialValues?.phone ?? '');
  const [email, setEmail] = useState(initialValues?.email ?? '');
  const [city, setCity] = useState(initialValues?.city ?? '');
  const [address, setAddress] = useState(initialValues?.address ?? '');
  const [registrationCode, setRegistrationCode] = useState(initialValues?.registrationCode ?? '');
  const [theme, setTheme] = useState<SchoolUniformTheme>(() =>
    normalizeSchoolTheme(initialValues?.theme ?? getSavedPreviewTheme())
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google account linking status
  const [linkedProviders, setLinkedProviders] = useState<string[]>(() =>
    getLinkedProviders(auth.currentUser)
  );
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [linkStatus, setLinkStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Delete School modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingSchool, setDeletingSchool] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Cloud server URL settings
  const [serverUrl, setServerUrl] = useState(() => getSavedApiBaseUrl() || getApiBaseUrl());
  const [testingServer, setTestingServer] = useState(false);
  const [serverTestResult, setServerTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const hasGoogleLinked = linkedProviders.includes('google.com');

  const handleLinkGoogle = async () => {
    setLinkingGoogle(true);
    setLinkStatus(null);
    try {
      const updated = await linkGoogleAccountToCurrentUser();
      setLinkedProviders(getLinkedProviders(updated));
      setLinkStatus({
        ok: true,
        text: `Compte Google (${updated.email || 'lié'}) associé avec succès à votre profil.`,
      });
    } catch (err: unknown) {
      setLinkStatus({
        ok: false,
        text: err instanceof Error ? err.message : 'Impossible de lier votre compte Google.',
      });
    } finally {
      setLinkingGoogle(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (schoolName.trim().length < 2 || adminName.trim().length < 2) {
      setError("Veuillez renseigner le nom de l'établissement et le nom de l'administrateur.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        schoolName,
        adminName,
        academicYear,
        endOfYearDate,
        motto,
        phone,
        email,
        address,
        city,
        registrationCode,
        theme,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAndSaveServer = async () => {
    const saved = setSavedApiBaseUrl(serverUrl);
    setServerUrl(saved);
    const activeUrl = getApiBaseUrl();
    setServerTestResult(null);
    if (compiledShell && !activeUrl) {
      setServerTestResult({
        ok: false,
        text: "Renseignez d'abord l'URL HTTPS de votre déploiement Vercel (ex : https://mon-ecole.vercel.app).",
      });
      return;
    }
    setTestingServer(true);
    try {
      const target = activeUrl ? `${activeUrl}/api/health` : '/api/health';
      const res = await fetch(target);
      const data = (await res.json()) as { ok?: boolean; aiConfigured?: boolean };
      if (!res.ok || !data.ok) {
        throw new Error(`Statut HTTP ${res.status}`);
      }
      setServerTestResult({
        ok: true,
        text: `Serveur Vercel / Node.js connecté (${activeUrl || window.location.origin}) · Yasmine IA ${
          data.aiConfigured ? 'active' : 'en attente de clé GEMINI_API_KEY sur Vercel'
        }.`,
      });
    } catch (err: unknown) {
      setServerTestResult({
        ok: false,
        text: `Impossible de joindre le serveur : ${err instanceof Error ? err.message : 'erreur réseau'}.`,
      });
    } finally {
      setTestingServer(false);
    }
  };

  const handleConfirmDeleteSchool = async () => {
    if (!onDeleteSchool) return;
    setDeletingSchool(true);
    setDeleteError(null);
    try {
      await onDeleteSchool();
      setDeleteModalOpen(false);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Erreur lors de la suppression de l'école.");
    } finally {
      setDeletingSchool(false);
    }
  };

  return (
    <div className={isEdit ? 'space-y-6 max-w-3xl mx-auto' : 'min-h-screen flex items-center justify-center p-4 sm:p-6 relative z-10'}>
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className={`${isEdit ? 'w-full' : 'max-w-2xl w-full'} bg-white/95 backdrop-blur-xs border theme-border-soft rounded-2xl p-6 sm:p-8 shadow-sm`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl theme-pill-soft border flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-900">
                {isEdit ? "Fiche officielle de l'établissement" : "Enregistrement des infos de l'établissement"}
              </h2>
              <p className="text-xs text-zinc-500">
                Ces informations figurent en en-tête de vos bulletins, certificats et relevés de notes.
              </p>
            </div>
          </div>

          {isEdit && onExportBackup && (
            <button
              type="button"
              onClick={onExportBackup}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border theme-pill-soft text-xs font-semibold transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Sauvegarde locale (.json)
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Nom complet de l'établissement *
              </label>
              <input
                type="text"
                required
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                placeholder="Ex : Complexe Scolaire Les Lumières"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Code / N° d'agrément
              </label>
              <input
                type="text"
                value={registrationCode}
                onChange={(e) => setRegistrationCode(e.target.value)}
                placeholder="Ex : MEN-2026-412"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm font-mono-nums transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Directeur / Administrateur *
              </label>
              <div className="relative">
                <UserCheck className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Ex : M. Victor"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Année scolaire *
              </label>
              <input
                type="text"
                required
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder="2026-2027"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm font-mono-nums transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Date de fin d’année prévue
              </label>
              <input
                type="date"
                value={endOfYearDate}
                onChange={(e) => setEndOfYearDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm font-mono-nums transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Email officiel de l'école
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@ecole-lumieres.org"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Téléphone secrétariat
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+228 22 00 00 00"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm font-mono-nums transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Ville / Commune
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ex : Lomé"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm transition-all"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Adresse complète / Quartier
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Ex : Quartier Tokoin, Rue des Écoles"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
              Devise de l'établissement (affichée sur les bulletins)
            </label>
            <input
              type="text"
              value={motto}
              onChange={(e) => setMotto(e.target.value)}
              placeholder="Discipline · Travail · Succès"
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 theme-input outline-none text-sm transition-all"
            />
          </div>

          <UniformThemePicker
            variant="grid"
            value={theme}
            onChange={(nextTheme) => {
              setTheme(nextTheme);
              savePreviewTheme(nextTheme);
            }}
          />

          <div className="pt-4 flex items-center justify-end gap-3">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                {cancelLabel || 'Annuler'}
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl theme-btn-primary text-sm font-semibold transition-all active:scale-[0.99] disabled:opacity-60"
            >
              <span>{saving ? 'Enregistrement...' : isEdit ? 'Mettre à jour' : 'Commencer'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </motion.div>

      {isEdit && isOwner && (onOpenYearTransition || onOpenArchives) && (
        <div className="bg-white/95 border theme-border-soft rounded-2xl p-6 space-y-3 shadow-xs">
          <div className="flex items-center gap-2 text-sm font-bold theme-text-ink">
            <CalendarClock className="w-4 h-4 theme-text-accent shrink-0" />
            <span>Clôture d’année scolaire & Archivage annuel</span>
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed">
            À la fin de l’année ({endOfYearDate || academicYear}), archivez les résultats, promouvez automatiquement les élèves vers la classe supérieure (6ème → 3ème → 2nde → Tle) et préparez la nouvelle rentrée sans perdre les archives.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {onOpenYearTransition && (
              <button
                type="button"
                onClick={onOpenYearTransition}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl theme-btn-primary text-xs font-bold transition-colors"
              >
                <CalendarClock className="w-3.5 h-3.5" />
                Passer à une nouvelle année scolaire
              </button>
            )}
            {onOpenArchives && (
              <button
                type="button"
                onClick={onOpenArchives}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border theme-pill-soft text-xs font-bold transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                Consulter les archives annuelles
              </button>
            )}
          </div>
        </div>
      )}

      {isEdit && (
        <div className="bg-white/95 border theme-border-soft rounded-2xl p-6 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold theme-text-ink">
              <Link2 className="w-4 h-4 theme-text-accent shrink-0" />
              <span>Mon compte de connexion (Téléphone / E-mail & Google)</span>
            </div>
            {hasGoogleLinked ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Compte Google lié
              </span>
            ) : (
              <button
                type="button"
                onClick={handleLinkGoogle}
                disabled={linkingGoogle}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border theme-pill-soft text-xs font-bold transition-colors disabled:opacity-60"
              >
                <Link2 className="w-3.5 h-3.5" />
                {linkingGoogle ? 'Association...' : 'Lier mon compte Google'}
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed">
            Connecté sous <strong className="text-zinc-900">{formatAuthIdentifierForDisplay(auth.currentUser?.email)}</strong>. Associer votre compte Google vous permet d’utiliser indifféremment votre mot de passe ou Google.
          </p>
          {linkStatus && (
            <div
              className={`p-3 rounded-xl border text-xs font-medium ${
                linkStatus.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {linkStatus.text}
            </div>
          )}
        </div>
      )}

      {isEdit && (
        <div className="bg-white/95 border theme-border-soft rounded-2xl p-6 space-y-3 shadow-xs">
          <div className="flex items-center gap-2 text-sm font-bold theme-text-ink">
            <Globe className="w-4 h-4 theme-text-accent shrink-0" />
            <span>Serveur Cloud Node.js / Vercel (PC .exe / Android .apk)</span>
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed">
            Indiquez l’URL HTTPS de votre site Vercel (ex : <code className="px-1 py-0.5 theme-pill-soft rounded">https://mon-ecole.vercel.app</code>) pour relier vos versions compilées PC et Android à Yasmine IA.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://mon-ecole.vercel.app"
              className="flex-1 px-3.5 py-2 rounded-xl border border-zinc-200 theme-input outline-none text-xs"
            />
            <button
              type="button"
              onClick={handleTestAndSaveServer}
              disabled={testingServer}
              className="px-4 py-2 rounded-xl theme-btn-primary text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {testingServer ? 'Test en cours...' : 'Enregistrer & Tester'}
            </button>
          </div>
          {serverTestResult && (
            <div
              className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                serverTestResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {serverTestResult.ok && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{serverTestResult.text}</span>
            </div>
          )}
        </div>
      )}

      {isEdit && !compiledShell && !isStandalone && (
        <div className="theme-surface-header border rounded-2xl p-6 space-y-4 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-bold">
              <Server className="w-4 h-4 shrink-0" />
              <span>Installation PC / Mobile & Déploiement (Serveur École ou Cloud)</span>
            </div>
            <PWAInstallButton variant="card" />
          </div>
          <p className="text-xs theme-header-subtext leading-relaxed">
            <strong>1. Installation directe (PC Windows/Mac & Mobile Android/iPhone) :</strong> Grâce au mode PWA intégré, cliquez sur <em>Installer (PC / Mobile)</em> pour placer l’icône de votre école sur votre Bureau ou écran d’accueil sans passer par un store.
          </p>
          <p className="text-xs theme-header-subtext leading-relaxed">
            <strong>2. Serveur unique Node.js / Express :</strong> Ce système embarque son propre serveur (<code className="px-1.5 py-0.5 theme-header-chip rounded">server.ts</code> sur le port 3000) compatible PC (Electron), Android (APK) et iOS.
          </p>
        </div>
      )}

      {isEdit && isOwner && onDeleteSchool && (
        <div className="bg-rose-50/85 border border-rose-200 rounded-2xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-rose-900">
            <Trash2 className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Zone dangereuse · Supprimer cet établissement</span>
          </div>
          <p className="text-xs text-rose-800/90 leading-relaxed">
            Cette action supprime définitivement l’établissement « <strong>{initialValues?.schoolName || schoolName}</strong> », toutes ses classes, élèves, notes, bulletins et accès associés.
          </p>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setDeleteModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Supprimer définitivement cet établissement
          </button>
        </div>
      )}

      <ConfirmModal
        open={deleteModalOpen}
        title="Supprimer définitivement l’établissement ?"
        description={`Vous êtes sur le point de supprimer « ${initialValues?.schoolName || schoolName} » ainsi que tous ses élèves, classes, notes, bulletins et archives. Cette opération est irréversible.`}
        confirmLabel="Supprimer définitivement"
        tone="danger"
        requireTextMatch={initialValues?.schoolName || schoolName}
        requireTextLabel={`Pour confirmer, recopiez exactement « ${initialValues?.schoolName || schoolName} » :`}
        loading={deletingSchool}
        error={deleteError}
        onCancel={() => !deletingSchool && setDeleteModalOpen(false)}
        onConfirm={handleConfirmDeleteSchool}
      />
    </div>
  );
}
