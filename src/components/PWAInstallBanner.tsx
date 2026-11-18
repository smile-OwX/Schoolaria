import { useState } from 'react';
import {
  Download,
  MonitorSmartphone,
  Share,
  WifiOff,
  X,
  CheckCircle2,
  Laptop,
  Smartphone,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'card';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { canNativeInstall, isIOS, isStandalone, promptInstall } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isStandalone) return null;

  const handleClick = async () => {
    if (canNativeInstall) {
      const accepted = await promptInstall();
      if (accepted) return;
    }
    setShowGuideModal(true);
  };

  const buttonClass =
    variant === 'sidebar'
      ? 'w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold transition-all whitespace-nowrap shrink-0'
      : variant === 'card'
      ? 'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0'
      : 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0';

  return (
    <>
      <button type="button" onClick={handleClick} className={buttonClass}>
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Installer (PC / Mobile)</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-50 bg-violet-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-violet-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-700 to-indigo-700 text-white flex items-center justify-center shrink-0">
                  <MonitorSmartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-violet-950">
                    Installer Schoolaria sur PC & Mobile
                  </h3>
                  <p className="text-xs text-violet-700">
                    Application Web Progressive (PWA) · Aucun store requis
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-violet-50 hover:text-violet-800"
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="p-4 rounded-xl bg-violet-50 border border-violet-200 space-y-2 text-xs">
                <p className="font-bold text-violet-950 flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-violet-700" />
                  Installation sur iPhone / iPad (Safari)
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-zinc-700">
                  <li>
                    Appuyez sur le bouton <Share className="w-3.5 h-3.5 inline text-violet-700" />{' '}
                    <strong>Partager</strong> en bas de Safari.
                  </li>
                  <li>
                    Faites défiler et choisissez <strong>« Sur l’écran d’accueil »</strong>.
                  </li>
                  <li>
                    Appuyez sur <strong>Ajouter</strong> : l’icône violette de votre école apparaît comme une vraie application.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="p-4 rounded-xl bg-violet-50 border border-violet-200 space-y-1.5">
                  <p className="font-bold text-violet-950 flex items-center gap-2">
                    <Laptop className="w-4 h-4 text-violet-700" />
                    Installer & Épingler sur le Bureau (PC · Chrome ou Edge)
                  </p>
                  <p className="text-zinc-700 leading-relaxed">
                    Ouvrez l’application dans un onglet direct, puis cliquez sur l’icône{' '}
                    <strong>Installer</strong> à droite de la barre d’adresse (ou Menu ⋮ →{' '}
                    <strong>Caster, enregistrer et partager → Installer Schoolaria</strong>). Une fenêtre dédiée sans barre de navigateur s’ouvre : faites un clic droit sur l’icône dans la barre des tâches → <strong>Épingler</strong> et cochez <strong>Créer un raccourci sur le Bureau</strong>.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 space-y-1.5">
                  <p className="font-bold text-indigo-950 flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-indigo-700" />
                    Installer sur Smartphone (Android & iPhone)
                  </p>
                  <p className="text-zinc-700 leading-relaxed">
                    Sur <strong>Android (Chrome)</strong> : Menu ⋮ → <strong>« Ajouter à l’écran d’accueil »</strong> → <strong>Installer</strong>. Sur <strong>iPhone (Safari)</strong> : bouton <strong>Partager</strong> → <strong>« Sur l’écran d’accueil »</strong> → <strong>Ajouter</strong>.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <p className="text-zinc-700 leading-relaxed">
                    <strong>Mode Hors-ligne / Délestage activé :</strong> Après une première ouverture avec connexion, l’application, vos classes, élèves, notes et bulletins sont sauvegardés localement sur votre appareil (Service Worker + base locale IndexedDB). En cas de coupure réseau ou de délestage, vous pouvez continuer à consulter et saisir des notes : tout se synchronisera automatiquement dès le retour d’Internet.
                  </p>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="px-5 py-2 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold transition-colors"
              >
                Compris
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="no-print bg-amber-600 text-white text-xs font-semibold px-4 py-2 flex items-center justify-center gap-2 z-50">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        Mode hors-ligne (délestage) — Les données locales sont chargées et vos saisies se synchroniseront automatiquement au retour d’Internet.
      </span>
    </div>
  );
}
