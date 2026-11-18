@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

cd /d "%~dp0"

set "NO_PAUSE=0"
set "ARG_URL="
for %%A in (%*) do (
    if /I "%%~A"=="--no-pause" (
        set "NO_PAUSE=1"
    ) else (
        if not defined ARG_URL set "ARG_URL=%%~A"
    )
)

echo.
echo ========================================================================
echo   SCHOOLARIA - Generateur automatique d'APK Android (Windows CMD)
echo ========================================================================
echo.

:: ------------------------------------------------------------------------
:: 1. Configuration de l'URL du serveur Node.js cloud
:: ------------------------------------------------------------------------
set "DEFAULT_API_URL=https://ais-pre-m6gzqqvvbgs75evw5t7ntn-1010398430814.europe-west2.run.app"

if defined ARG_URL (
    set "API_URL=%ARG_URL%"
) else (
    echo Adresse par defaut du serveur cloud :
    echo   %DEFAULT_API_URL%
    echo.
    set "INPUT_URL="
    set /p "INPUT_URL=Collez une autre URL ou appuyez sur ENTREE pour garder celle par defaut : "
    if "!INPUT_URL!"=="" (
        set "API_URL=%DEFAULT_API_URL%"
    ) else (
        set "API_URL=!INPUT_URL!"
    )
)

:: Retirer un eventuel slash final
if "%API_URL:~-1%"=="/" set "API_URL=%API_URL:~0,-1%"

echo.
echo [OK] Serveur cible configure : %API_URL%
echo.

:: ------------------------------------------------------------------------
:: 2. Verification de Node.js / npm et detection auto JDK + Android SDK
:: ------------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js est introuvable dans le PATH Windows.
    echo Installez Node.js 20 LTS depuis https://nodejs.org puis relancez ce script.
    goto :fail
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] npm est introuvable dans le PATH Windows.
    goto :fail
)

:: Detection automatique du JDK integre d'Android Studio si JAVA_HOME absent
if not defined JAVA_HOME (
    if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
    ) else if exist "%ProgramFiles%\Android\Android Studio\jre\bin\java.exe" (
        set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jre"
    ) else if exist "%ProgramFiles(x86)%\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=%ProgramFiles(x86)%\Android\Android Studio\jbr"
    ) else if exist "%LOCALAPPDATA%\Programs\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=%LOCALAPPDATA%\Programs\Android Studio\jbr"
    )
)

if defined JAVA_HOME (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
    echo [OK] JAVA_HOME detecte : %JAVA_HOME%
) else (
    where java >nul 2>nul
    if errorlevel 1 (
        echo [ERREUR] Java JDK introuvable ^(Android Studio JBR ou JDK 17 requis^).
        echo Verifiez l'installation d'Android Studio ou definissez JAVA_HOME.
        goto :fail
    )
    echo [OK] Java detecte dans le PATH systeme.
)

:: Detection automatique du SDK Android
if not defined ANDROID_HOME (
    if defined ANDROID_SDK_ROOT (
        set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
    ) else if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools" (
        set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
    ) else if exist "%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools" (
        set "ANDROID_HOME=%USERPROFILE%\AppData\Local\Android\Sdk"
    ) else if exist "C:\Android\Sdk\platform-tools" (
        set "ANDROID_HOME=C:\Android\Sdk"
    )
)

if not defined ANDROID_HOME (
    echo [ERREUR] Dossier Android SDK introuvable ^(ANDROID_HOME^).
    echo Ouvrez Android Studio ^> Settings ^> Languages ^& Frameworks ^> Android SDK pour verifier l'emplacement.
    goto :fail
)

set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%ANDROID_HOME%\platform-tools;%PATH%"
echo [OK] ANDROID_HOME detecte : %ANDROID_HOME%
echo.

:: ------------------------------------------------------------------------
:: 3. Installation des dependances npm & Capacitor Android (si manquantes)
:: ------------------------------------------------------------------------
if not exist "node_modules\" (
    echo [1/5] Installation des dependances du projet ^(npm install^)...
    call npm install
    if errorlevel 1 (
        echo [ERREUR] Echec de npm install.
        goto :fail
    )
) else (
    echo [1/5] Dependances de base deja installees.
)

if not exist "node_modules\@capacitor\android\package.json" (
    echo [2/5] Installation de Capacitor Android ^(@capacitor/core, cli, android^)...
    call npm install --no-audit --no-fund @capacitor/core @capacitor/cli @capacitor/android
    if errorlevel 1 (
        echo [ERREUR] Echec de l'installation de Capacitor Android.
        goto :fail
    )
) else (
    echo [2/5] Capacitor Android deja installe.
)

:: ------------------------------------------------------------------------
:: 4. Compilation du bundle mobile (Vite native -> dist/)
:: ------------------------------------------------------------------------
echo.
echo [3/5] Compilation de l'interface mobile ^(build:native^)...
set "VITE_API_BASE_URL=%API_URL%"
set "VITE_APP_TARGET=native"
call npm run build:native
if errorlevel 1 (
    echo [ERREUR] Echec de la compilation Vite ^(build:native^).
    goto :fail
)

:: ------------------------------------------------------------------------
:: 5. Creation ou synchronisation du projet Android Capacitor
:: ------------------------------------------------------------------------
echo.
echo [4/5] Synchronisation Capacitor Android...
if not exist "android\gradlew.bat" (
    echo Initialisation du dossier android\ via npx cap add android...
    call npx cap add android
    if errorlevel 1 (
        echo [ERREUR] Echec de npx cap add android.
        goto :fail
    )
)

:: Creer android\local.properties si absent pour eviter "SDK location not found"
if not exist "android\local.properties" (
    set "SDK_ESCAPED=%ANDROID_HOME:\=\\%"
    set "SDK_ESCAPED=!SDK_ESCAPED::=\:!"
    > "android\local.properties" echo sdk.dir=!SDK_ESCAPED!
    echo [OK] Fichier android\local.properties genere automatiquement.
)

call npx cap sync android
if errorlevel 1 (
    echo [ERREUR] Echec de npx cap sync android.
    goto :fail
)

:: ------------------------------------------------------------------------
:: 6. Compilation Gradle de l'APK Debug installable
:: ------------------------------------------------------------------------
echo.
echo [5/5] Generation du fichier APK via Gradle ^(assembleDebug^)...
echo       ^(Le premier lancement peut prendre 2 a 5 minutes le temps de telecharger Gradle^)
echo.
pushd android
call gradlew.bat assembleDebug
set "GRADLE_ERR=%ERRORLEVEL%"
popd

if not "%GRADLE_ERR%"=="0" (
    echo.
    echo [ERREUR] Echec de la compilation Gradle ^(code %GRADLE_ERR%^).
    echo Astuce : Si Gradle mentionne les licences SDK, lancez dans CMD :
    echo   "%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
    goto :fail
)

set "RAW_APK=android\app\build\outputs\apk\debug\app-debug.apk"
if not exist "%RAW_APK%" (
    echo [ERREUR] Compilation terminee mais le fichier APK est introuvable : %RAW_APK%
    goto :fail
)

if not exist "release\" mkdir "release"
copy /Y "%RAW_APK%" "release\Schoolaria-v1.0.0.apk" >nul

echo.
echo ========================================================================
echo   SUCCES ! VOTRE APK ANDROID EST PRET A INSTALLER
echo ========================================================================
echo.
echo   Fichier principal : %~dp0release\Schoolaria-v1.0.0.apk
echo   Original Gradle   : %~dp0%RAW_APK%
echo   Serveur configure : %API_URL%
echo.
echo   Pour installer sur votre telephone Android :
echo     1. Copiez "release\Schoolaria-v1.0.0.apk" sur votre telephone et ouvrez-le
echo     2. OU branchez le telephone en USB ^(debogage USB active^) et tapez :
echo        adb install -r "release\Schoolaria-v1.0.0.apk"
echo.
echo   Connexion Google sur APK :
echo     - Firebase Console ^> Authentication ^> Authorized domains : ajoutez "localhost"
echo     - Pour l'empreinte SHA-1 : cd android ^&^& gradlew.bat signingReport
echo ========================================================================
echo.
if "%NO_PAUSE%"=="0" pause
exit /b 0

:fail
echo.
echo [ECHEC] La generation de l'APK a ete interrompue. Lisez le message ci-dessus.
echo.
if "%NO_PAUSE%"=="0" pause
exit /b 1
