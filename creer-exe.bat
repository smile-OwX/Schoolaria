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
echo   SCHOOLARIA - Generateur automatique de .EXE Windows (CMD)
echo ========================================================================
echo.

set "URL_CACHE_FILE=.schoolaria-server-url.txt"
set "SAVED_API_URL="
if exist "%URL_CACHE_FILE%" (
    set /p SAVED_API_URL=<"%URL_CACHE_FILE%"
)

if defined ARG_URL (
    set "API_URL=%ARG_URL%"
) else (
    if defined SAVED_API_URL (
        echo Derniere URL Vercel enregistree :
        echo   !SAVED_API_URL!
        echo.
        set "INPUT_URL="
        set /p "INPUT_URL=Collez une autre URL Vercel ou appuyez sur ENTREE pour garder celle-ci : "
        if "!INPUT_URL!"=="" (
            set "API_URL=!SAVED_API_URL!"
        ) else (
            set "API_URL=!INPUT_URL!"
        )
    ) else (
        echo Entrez l'URL de votre site Schoolaria deploye sur Vercel
        echo Exemple : https://mon-ecole.vercel.app
        echo.
        set "INPUT_URL="
        set /p "INPUT_URL=URL Vercel du serveur : "
        if "!INPUT_URL!"=="" (
            echo [ERREUR] Vous devez indiquer l'URL de votre deploiement Vercel pour compiler le .EXE.
            goto :fail
        )
        set "API_URL=!INPUT_URL!"
    )
)

:: Nettoyer espaces et slash final, puis ajouter https:// si absent
for /f "tokens=* delims= " %%U in ("%API_URL%") do set "API_URL=%%U"
if /I not "%API_URL:~0,7%"=="http://" if /I not "%API_URL:~0,8%"=="https://" set "API_URL=https://%API_URL%"
if "%API_URL:~-1%"=="/" set "API_URL=%API_URL:~0,-1%"

> "%URL_CACHE_FILE%" echo %API_URL%

echo.
echo [OK] Serveur Vercel configure et memorise : %API_URL%
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERREUR] Node.js est introuvable dans le PATH Windows.
    echo Installez Node.js 20 LTS depuis https://nodejs.org puis relancez ce script.
    goto :fail
)

if not exist "node_modules\" (
    echo [1/3] Installation des dependances du projet ^(--legacy-peer-deps^)...
    call npm install --legacy-peer-deps
    if errorlevel 1 (
        echo [ERREUR] Echec de npm install --legacy-peer-deps.
        goto :fail
    )
) else (
    echo [1/3] Dependances de base deja installees.
)

set "NEED_ELECTRON=0"
if not exist "node_modules\electron\package.json" set "NEED_ELECTRON=1"
if not exist "node_modules\electron-builder\package.json" set "NEED_ELECTRON=1"

if "%NEED_ELECTRON%"=="1" (
    echo [2/3] Installation de Electron et Electron Builder ^(--legacy-peer-deps^)...
    call npm install --legacy-peer-deps --no-audit --no-fund -D electron electron-builder
    if errorlevel 1 (
        echo [ERREUR] Echec de l'installation d'Electron.
        goto :fail
    )
) else (
    echo [2/3] Electron et Electron Builder deja installes.
)

echo.
echo [3/3] Generation de l'icone Schoolaria, compilation desktop et empaquetage .EXE Windows...
call node scripts\ensure-icons.mjs
if errorlevel 1 (
    echo [ERREUR] Echec de la generation de build\icon.ico.
    goto :fail
)
set "VITE_API_BASE_URL=%API_URL%"
set "VITE_APP_TARGET=desktop"
call npm run build:exe
if errorlevel 1 (
    echo.
    echo [ERREUR] Echec de build:exe.
    echo Astuce : Si vous voyez "Cannot create symbolic link", lancez CMD en tant
    echo          qu'Administrateur ^(clic droit ^> Executer en tant qu'administrateur^)
    echo          et relancez simplement creer-exe.bat.
    goto :fail
)

echo.
echo ========================================================================
echo   SUCCES ! VOS FICHIERS .EXE WINDOWS SONT PRETS
echo ========================================================================
echo.
echo   Installateur : %~dp0release\Schoolaria Setup 1.0.0.exe
echo   Portable     : %~dp0release\Schoolaria 1.0.0.exe
echo   Serveur      : %API_URL%
echo.
echo   Connexion Google : fonctionne directement dans l'application OU via
echo   le bouton "Se connecter via Chrome / Edge" si votre compte est deja ouvert.
echo ========================================================================
echo.
if "%NO_PAUSE%"=="0" pause
exit /b 0

:fail
echo.
echo [ECHEC] La generation du .EXE a ete interrompue. Lisez le message ci-dessus.
echo.
if "%NO_PAUSE%"=="0" pause
exit /b 1
