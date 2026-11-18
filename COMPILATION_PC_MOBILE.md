# Guide direct de compilation : `.exe` (Windows) & `.apk` (Android)

**Tout est déjà pré-configuré dans `package.json`, `vite.config.ts`, `capacitor.config.ts`, `electron/main.cjs` et `creer-apk.bat`.**  
Vous n'avez **aucun fichier de code ou JSON à modifier**.

---

## Étape 1 : Déployer le serveur Node.js cloud unique (1 seule fois)

Sur votre serveur (Google Cloud Run, Railway, Render ou VPS) :
```bash
npm install
npm run build
GEMINI_API_KEY="votre_cle_gemini" PORT=3000 npm start
```
Notez l'URL HTTPS publique de votre serveur (exemple : `https://ais-pre-m6gzqqvvbgs75evw5t7ntn-1010398430814.europe-west2.run.app`).

---

## Étape 2 : Autoriser les domaines dans Firebase Authentication

Dans **Firebase Console → Authentication → Settings → Authorized domains**, ajoutez :
1. Le domaine de votre serveur cloud
2. `localhost`
3. `capacitor://localhost`

---

## Étape 3 : Générer l'installateur Windows (`.exe`) sur votre PC

Prérequis sur Windows : **Node.js 20 LTS** (ou supérieur).  
Ouvrez **CMD** dans le dossier du projet et exécutez ces **4 commandes** :

```cmd
npm install
set VITE_API_BASE_URL=https://ais-pre-m6gzqqvvbgs75evw5t7ntn-1010398430814.europe-west2.run.app
npm install -D electron electron-builder
npm run build:exe
```

> Résultat : votre fichier `.exe` est généré dans **`release\Schoolaria Setup 1.0.0.exe`** (et une version portable sans installation dans `release\Schoolaria 1.0.0.exe`).

*(Pour tester l'application desktop avant de créer le `.exe` : `npm run desktop:preview`)*

---

## Étape 4 : Générer l'application Android (`.apk`) depuis Windows CMD

Prérequis sur votre PC : **Node.js 20 LTS** et **Android Studio** (avec Android SDK installé).

### Méthode automatique (1 seule commande CMD)

Ouvrez l'Invite de commandes (**CMD**) dans le dossier du projet et tapez :
```cmd
creer-apk.bat
```
- Appuyez sur **Entrée** pour confirmer l'URL serveur pré-configurée (ou collez une autre URL).
- Le script détecte automatiquement le JDK d'Android Studio et votre SDK Android, installe Capacitor si absent, compile le bundle mobile, synchronise `android\` et lance Gradle.
- Votre APK prêt à installer sur téléphone est généré dans : **`release\Schoolaria-v1.0.0.apk`**.

### Méthode manuelle CMD (étape par étape)

```cmd
npm install
set VITE_API_BASE_URL=https://ais-pre-m6gzqqvvbgs75evw5t7ntn-1010398430814.europe-west2.run.app
npm install @capacitor/core @capacitor/cli @capacitor/android
npm run build:native
npx cap add android
npx cap sync android
cd android && gradlew.bat assembleDebug
```
Le fichier créé est dans **`android\app\build\outputs\apk\debug\app-debug.apk`**.

### Connexion Google sur Android (`.apk`)
Dans le dossier `android/`, exécutez `gradlew.bat signingReport`, copiez l'empreinte **SHA-1**, puis ajoutez-la dans **Firebase Console → Paramètres du projet → Vos applications → Android**.

---

## Option iOS (`.ipa` sur macOS + Xcode)

```bash
npm install
export VITE_API_BASE_URL="https://ais-pre-m6gzqqvvbgs75evw5t7ntn-1010398430814.europe-west2.run.app"
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npm run cap:ios
```
Dans Xcode : choisissez votre équipe de signature (*Signing & Capabilities*) puis **Product → Archive**.
