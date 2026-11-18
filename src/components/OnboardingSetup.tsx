import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Building2,
  GraduationCap,
  ShieldCheck,
  UserCheck,
  ArrowRight,
  Download,
  Server,
  CheckCircle2,
  Globe,
} from 'lucide-react';
import { formatFirebaseAuthError, isCompiledShell, signInWithGoogle } from '../lib/firebase.ts';
import {
  getApiBaseUrl,
  getSavedApiBaseUrl,
  setSavedApiBaseUrl,
} from '../lib/apiClient.ts';
import { SchoolProfile } from '../types/school.ts';
import { PWAInstallButton } from './PWAInstallBanner.tsx';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

interface AuthGateProps {
  onSuccess?: () => void;
}

export function AuthGate({ onSuccess }: AuthGateProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compiledShell = isCompiledShell();
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(() => getSavedApiBaseUrl());
  const [serverSaved, setServerSaved] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : formatFirebaseAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveServerUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedApiBaseUrl(serverUrlInput);
    setServerSaved(
      serverUrlInput.trim()
        ? `Serveur cloud enregistré : ${getApiBaseUrl()}`
        : 'URL réinitialisée.'
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative z-10">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-md w-full bg-white/95 backdrop-blur-xs border border-violet-300/80 rounded-2xl overflow-hidden shadow-xl"
      >
        <div className="bg-gradient-to-r from-violet-950 via-violet-800 to-indigo-900 text-white p-6 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white text-violet-900 flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-white">Schoolaria</h1>
            <p className="text-xs text-violet-200">Administration · Enseignants · Parents</p>
          </div>
        </div>

        <div className="p-8">
          <h2 className="text-lg font-bold text-violet-950 mb-2 text-balance">
            Connectez votre espace scolaire
          </h2>
          <p className="text-sm text-zinc-600 leading-relaxed mb-6">
            Authentifiez-vous avec votre compte Google pour accéder à votre tableau de bord personnalisé (Direction, Enseignant ou Parent) et vos bulletins sécurisés.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 leading-relaxed">
              {error}
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-zinc-50 border border-zinc-300 rounded-xl text-sm font-semibold text-zinc-800 transition-all shadow-xs active:scale-[0.99] disabled:opacity-60"
          >
            <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            {loading ? 'Connexion en cours...' : 'Continuer avec Google'}
          </button>

          {compiledShell && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowServerConfig((v) => !v)}
                className="text-xs font-semibold text-violet-700 hover:underline flex items-center gap-1.5"
              >
                <Globe className="w-3.5 h-3.5" />
                {showServerConfig ? 'Masquer la config serveur cloud' : 'Configurer l’URL du serveur cloud Node.js'}
              </button>
              {showServerConfig && (
                <form onSubmit={handleSaveServerUrl} className="mt-2.5 p-3 rounded-xl bg-violet-50 border border-violet-200 space-y-2">
                  <input
                    type="url"
                    value={serverUrlInput}
                    onChange={(e) => setServerUrlInput(e.target.value)}
                    placeholder="https://votre-serveur-schoolaria.run.app"
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs outline-none focus:border-violet-600"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-emerald-700">{serverSaved || 'Optionnel si déjà compilé avec VITE_API_BASE_URL'}</span>
                    <button
                      type="submit"
                      className="px-3 py-1 rounded-lg bg-violet-700 text-white text-xs font-semibold shrink-0"
                    >
                      Enregistrer
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-violet-100 flex items-center justify-between gap-2 text-xs text-violet-700">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-violet-600 shrink-0" />
              <span>Accès cloisonné par rôle et établissement.</span>
            </span>
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
  motto?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  registrationCode?: string;
}

interface SchoolSetupProps {
  defaultAdminName: string;
  initialValues?: SchoolFormValues;
  isEdit?: boolean;
  cancelLabel?: string;
  schoolSnapshot?: SchoolProfile;
  onExportBackup?: () => void;
  onCancel?: () => void;
  onSubmit: (values: SchoolFormValues) => Promise<void>;
}

export function SchoolSetupForm({
  defaultAdminName,
  initialValues,
  isEdit = false,
  cancelLabel,
  onExportBackup,
  onCancel,
  onSubmit,
}: SchoolSetupProps) {
  const { isStandalone } = usePWAInstall();
  const compiledShell = isCompiledShell();
  const [schoolName, setSchoolName] = useState(initialValues?.schoolName ?? '');
  const [adminName, setAdminName] = useState(initialValues?.adminName ?? defaultAdminName);
  const [academicYear, setAcademicYear] = useState(initialValues?.academicYear ?? '2026-2027');
  const [motto, setMotto] = useState(initialValues?.motto ?? 'Travail · Discipline · Succès');
  const [phone, setPhone] = useState(initialValues?.phone ?? '');
  const [email, setEmail] = useState(initialValues?.email ?? '');
  const [city, setCity] = useState(initialValues?.city ?? '');
  const [address, setAddress] = useState(initialValues?.address ?? '');
  const [registrationCode, setRegistrationCode] = useState(initialValues?.registrationCode ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cloud server URL settings (used especially on compiled PC / Android / iOS apps)
  const [serverUrl, setServerUrl] = useState(() => getSavedApiBaseUrl() || getApiBaseUrl());
  const [testingServer, setTestingServer] = useState(false);
  const [serverTestResult, setServerTestResult] = useState<{ ok: boolean; text: string } | null>(null);

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
        motto,
        phone,
        email,
        address,
        city,
        registrationCode,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestAndSaveServer = async () => {
    setSavedApiBaseUrl(serverUrl);
    const activeUrl = getApiBaseUrl();
    setTestingServer(true);
    setServerTestResult(null);
    try {
      const target = activeUrl ? `${activeUrl}/api/health` : '/api/health';
      const res = await fetch(target);
      const data = (await res.json()) as { ok?: boolean; aiConfigured?: boolean; models?: { deep?: string } };
      if (!res.ok || !data.ok) {
        throw new Error(`Statut HTTP ${res.status}`);
      }
      setServerTestResult({
        ok: true,
        text: `Serveur Node.js connecté (${activeUrl || window.location.origin}) · Yasmine IA ${
          data.aiConfigured ? 'active' : 'en attente de clé serveur'
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

  return (
    <div className={isEdit ? 'space-y-6 max-w-3xl mx-auto' : 'min-h-screen flex items-center justify-center p-6 relative z-10'}>
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className={`${isEdit ? 'w-full' : 'max-w-2xl w-full'} bg-white/95 backdrop-blur-xs border border-violet-200/80 rounded-2xl p-6 sm:p-8 shadow-sm`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center shrink-0">
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-violet-200 bg-violet-50/70 hover:bg-violet-100 text-xs font-semibold text-violet-800 transition-colors"
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
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
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
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm font-mono-nums transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Nom du Directeur / Administrateur *
              </label>
              <div className="relative">
                <UserCheck className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Ex : M. Victor"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
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
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm font-mono-nums transition-all"
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
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
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
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm font-mono-nums transition-all"
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
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
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
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
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
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 focus:border-violet-600 focus:ring-2 focus:ring-violet-100 outline-none text-sm transition-all"
            />
          </div>

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
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-sm font-semibold transition-all active:scale-[0.99] disabled:opacity-60"
            >
              <span>{saving ? 'Enregistrement...' : isEdit ? 'Mettre à jour' : 'Commencer'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </motion.div>

      {isEdit && (
        <div className="bg-white/95 border border-violet-200 rounded-2xl p-6 space-y-3 shadow-xs">
          <div className="flex items-center gap-2 text-sm font-bold text-violet-950">
            <Globe className="w-4 h-4 text-violet-700 shrink-0" />
            <span>Serveur Cloud Node.js (PC compilé / Android APK / iOS)</span>
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed">
            Indiquez l’URL HTTPS de votre serveur Node.js unique (<code className="px-1 py-0.5 bg-violet-50 rounded">server.ts</code>) pour relier vos versions compilées PC, Android et iOS à l’assistant Yasmine et à l’archivage serveur.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://votre-serveur-schoolaria.run.app (vide = serveur local actuel)"
              className="flex-1 px-3.5 py-2 rounded-xl border border-zinc-200 focus:border-violet-600 outline-none text-xs"
            />
            <button
              type="button"
              onClick={handleTestAndSaveServer}
              disabled={testingServer}
              className="px-4 py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
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
        <div className="bg-gradient-to-r from-violet-950 via-violet-900 to-indigo-900 text-white border border-violet-700 rounded-2xl p-6 space-y-4 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-bold text-white">
              <Server className="w-4 h-4 text-violet-200 shrink-0" />
              <span>Installation PC / Mobile & Déploiement (Serveur École ou Cloud)</span>
            </div>
            <PWAInstallButton variant="card" />
          </div>
          <p className="text-xs text-violet-100/90 leading-relaxed">
            <strong>1. Installation directe (PC Windows/Mac & Mobile Android/iPhone) :</strong> Grâce au mode PWA intégré, cliquez sur <em>Installer (PC / Mobile)</em> pour placer l’icône violette de votre école sur votre Bureau ou écran d’accueil sans passer par un store.
          </p>
          <p className="text-xs text-violet-100/90 leading-relaxed">
            <strong>2. Serveur unique Node.js / Express :</strong> Ce système embarque son propre serveur (<code className="px-1.5 py-0.5 bg-white/15 rounded">server.ts</code> sur le port 3000) compatible PC (Electron), Android (APK) et iOS.
          </p>
        </div>
      )}
    </div>
  );
}

