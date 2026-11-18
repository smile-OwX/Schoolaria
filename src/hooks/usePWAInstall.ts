import { useEffect, useState } from 'react';
import { isCompiledShell } from '../lib/firebase.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PWA_INSTALLED_KEY = 'schoolaria_pwa_installed';

function checkStandaloneEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  if (isCompiledShell()) return true;

  const isStandaloneDisplay =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches;

  const isIOSStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  const isAndroidTWA =
    typeof document !== 'undefined' && document.referrer.startsWith('android-app://');

  if (isStandaloneDisplay || isIOSStandalone || isAndroidTWA) {
    return true;
  }

  return false;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkStandaloneEnvironment());
  const [isStandalone, setIsStandalone] = useState<boolean>(() => checkStandaloneEnvironment());

  const isIOS =
    typeof window !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  useEffect(() => {
    const refreshStandalone = () => {
      const active = checkStandaloneEnvironment();
      setIsStandalone(active);
      if (active) setIsInstalled(true);
    };

    refreshStandalone();

    const mqlStandalone = window.matchMedia('(display-mode: standalone)');
    const mqlFullscreen = window.matchMedia('(display-mode: fullscreen)');
    mqlStandalone.addEventListener?.('change', refreshStandalone);
    mqlFullscreen.addEventListener?.('change', refreshStandalone);

    const onBeforeInstall = (e: Event) => {
      if (checkStandaloneEnvironment()) return;
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      setIsStandalone(true);
      try {
        window.localStorage.setItem(PWA_INSTALLED_KEY, '1');
      } catch {
        // Ignore storage error
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);

    // Check Web App getInstalledRelatedApps if supported (Chrome/Edge desktop & Android)
    const nav = navigator as unknown as {
      getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string }>>;
    };
    if (typeof nav.getInstalledRelatedApps === 'function') {
      nav
        .getInstalledRelatedApps()
        .then((apps) => {
          if (Array.isArray(apps) && apps.length > 0) {
            setIsInstalled(true);
          }
        })
        .catch(() => {
          // Ignore unsupported origin errors
        });
    }

    return () => {
      mqlStandalone.removeEventListener?.('change', refreshStandalone);
      mqlFullscreen.removeEventListener?.('change', refreshStandalone);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setIsInstalled(true);
      try {
        window.localStorage.setItem(PWA_INSTALLED_KEY, '1');
      } catch {
        // Ignore
      }
      return true;
    }
    return false;
  };

  const hidden = isStandalone || isInstalled || isCompiledShell();

  return {
    canNativeInstall: Boolean(deferredPrompt) && !hidden,
    isIOS: isIOS && !hidden,
    isStandalone: hidden,
    promptInstall,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return isOnline;
}
