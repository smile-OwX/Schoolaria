# Guide complet de compilation PC (`.exe`) & Android (`.apk`)

Ce guide vous permet de générer sans erreur le fichier installable **Windows (`.exe`)** et **Android (`.apk`)** connectés à votre serveur Node.js cloud unique.

---

## Étape 1 : Déployer le serveur Node.js cloud unique (1 seule fois)

Sur votre serveur (Google Cloud Run, Railway, Render ou VPS) :
```bash
npm install
npm run build
GEMINI_API_KEY="votre_cle_gemini" PORT=3000 npm start
```
Récupérez votre URL HTTPS publique (ex : `https://schoolaria-serveur.run.app`).

---

## Étape 2 : Autoriser les domaines dans Firebase Authentication

Dans la **Console Firebase → Authentication → Settings → Authorized domains**, ajoutez :
1. Le domaine de votre serveur Node.js cloud (`schoolaria-serveur.run.app`)
2. `localhost`
3. `capacitor://localhost`

---

## Étape 3 : Compiler le fichier PC Windows (`.exe`) avec Electron

Prérequis sur votre PC Windows : **Node.js 20 LTS** (ou supérieur).

1. Générez le bundle desktop (sans service worker PWA, chemins relatifs `./`) :
```bash
# Sous PowerShell Windows :
$env:VITE_API_BASE_URL="https://schoolaria-serveur.run.app"
npm run build:desktop
```
*(Sous Linux / macOS / Git Bash : `VITE_API_BASE_URL="https://schoolaria-serveur.run.app" npm run build:desktop`)*

2. Installez Electron et Electron Builder en local sur votre poste de compilation :
```bash
npm install -D electron electron-builder
```

3. Testez l'application desktop immédiatement :
```bash
npx electron electron/main.cjs
```

4. Générez l'installateur `.exe` (et version portable `.exe`) dans le dossier `release/` :
```bash
npx electron-builder --win nsis portable \
  --config.appId="com.schoolaria.app" \
  --config.productName="Schoolaria" \
  --config.directories.output="release" \
  --config.extraMetadata.main="electron/main.cjs" \
  --config.files="dist/**/*" \
  --config.files="electron/**/*" \
  --config.win.target="nsis"
```
Votre installateur se trouvera dans `release/Schoolaria Setup 0.0.0.exe`.

---

## Étape 4 : Compiler le fichier Android (`.apk`) avec Capacitor & Android Studio

Prérequis sur votre PC : **Node.js 20 LTS**, **JDK 17** et **Android Studio** (avec Android SDK installé).

1. Générez le bundle mobile natif :
```bash
# Sous PowerShell Windows :
$env:VITE_API_BASE_URL="https://schoolaria-serveur.run.app"
npm run build:native
```
*(Sous Linux / macOS / Git Bash : `VITE_API_BASE_URL="https://schoolaria-serveur.run.app" npm run build:native`)*

2. Installez Capacitor et créez le projet Android (à faire une seule fois) :
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
```

3. Synchronisez vos fichiers `dist/` vers le projet Android :
```bash
npx cap sync android
```

4. Générez l'`.apk` :
- **Option A (via Android Studio)** :
  ```bash
  npx cap open android
  ```
  Dans Android Studio : **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
  Le fichier généré est dans `android/app/build/outputs/apk/debug/app-debug.apk`.
- **Option B (en ligne de commande directe avec Gradle)** :
  ```bash
  cd android
  ./gradlew assembleDebug    # Windows PowerShell : .\gradlew.bat assembleDebug
  ```
  *(Pour un APK Release signé Google Play, utilisez `Build → Generate Signed Bundle / APK` dans Android Studio).*

5. **Connexion Google sur Android APK** :
   Récupérez votre empreinte SHA-1 via `./gradlew signingReport` puis ajoutez-la dans **Firebase Console → Paramètres du projet → Vos applications → Android**.

---

## Option iOS (`.ipa` sur macOS + Xcode)
```bash
VITE_API_BASE_URL="https://schoolaria-serveur.run.app" npm run build:native
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios && npx cap sync ios && npx cap open ios
```
Dans Xcode : sélectionnez votre compte Signature puis **Product → Archive**.
