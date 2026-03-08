@echo off
setlocal

cd /d "%~dp0"
if not exist ".run" mkdir ".run"
if not exist ".run\pgsql" mkdir ".run\pgsql"

if not exist "backend\package.json" (
  echo [ERROR] backend\package.json was not found.
  pause
  exit /b 1
)

if not exist "frontend\package.json" (
  echo [ERROR] frontend\package.json was not found.
  pause
  exit /b 1
)

if not exist "backend\.env" (
  echo [WARNING] backend\.env was not found.
  echo Please create it from backend\.env.example before first run.
  echo.
)

set "PG_BIN="
for %%V in (18 17 16 15 14 13) do (
  if not defined PG_BIN if exist "C:\Program Files\PostgreSQL\%%V\bin\pg_ctl.exe" set "PG_BIN=C:\Program Files\PostgreSQL\%%V\bin"
)
if not defined PG_BIN set "PG_BIN=C:\Program Files\PostgreSQL\18\bin"
set "PG_DATA=%~dp0.run\pgsql\data_utf8"
set "PG_LOG=%~dp0.run\pgsql\postgres_utf8.log"
set "APP_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/ain_kharroube?schema=public"
set "USE_LOCAL_DB=0"
set "LAN_IP="
set "HAS_ADMIN=0"

for /f %%I in ('powershell -NoProfile -Command "$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1; if ($route) { $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' } | Select-Object -ExpandProperty IPAddress -First 1; if ($ip) { $ip } }"') do set "LAN_IP=%%I"

if not defined LAN_IP (
  set "LAN_IP=127.0.0.1"
)

net session >nul 2>nul
if "%errorlevel%"=="0" set "HAS_ADMIN=1"

set "APP_API_URL=http://%LAN_IP%:4000"
set "APP_WEB_URL=http://%LAN_IP%:4200"
set "APP_FRONTEND_ORIGINS=http://localhost:4200"
if /I not "%LAN_IP%"=="127.0.0.1" (
  set "APP_FRONTEND_ORIGINS=%APP_FRONTEND_ORIGINS%,http://%LAN_IP%:4200"
)

if "%HAS_ADMIN%"=="1" (
  netsh advfirewall firewall add rule name="Ain El Kharroube Frontend 4200" dir=in action=allow protocol=TCP localport=4200 profile=private,public >nul 2>nul
  netsh advfirewall firewall add rule name="Ain El Kharroube Backend 4000" dir=in action=allow protocol=TCP localport=4000 profile=private,public >nul 2>nul
) else (
  echo [INFO] Run this script as Administrator once to auto-open firewall ports 4200/4000 for LAN testing.
)

if exist "%PG_BIN%\pg_ctl.exe" (
  if not exist "%PG_DATA%\PG_VERSION" (
    echo Initializing local PostgreSQL data...
    "%PG_BIN%\initdb.exe" -D "%PG_DATA%" -U postgres -A trust -E UTF8 --locale=C
    if errorlevel 1 (
      echo [ERROR] Could not initialize local PostgreSQL data folder.
      pause
      exit /b 1
    )
    "%PG_BIN%\pg_ctl.exe" -D "%PG_DATA%" -l "%PG_LOG%" -o "-p 55432" start
    if errorlevel 1 (
      echo [ERROR] Could not start local PostgreSQL.
      pause
      exit /b 1
    )
    "%PG_BIN%\createdb.exe" -h 127.0.0.1 -p 55432 -U postgres ain_kharroube >nul 2>nul
    echo Applying migrations and seed...
    call cmd /c "cd /d ""%~dp0backend"" && set DATABASE_URL=%APP_DATABASE_URL% && npx prisma migrate deploy && npm run prisma:seed && npm run ensure:local-users"
    set "USE_LOCAL_DB=1"
  ) else (
    "%PG_BIN%\pg_ctl.exe" -D "%PG_DATA%" status >nul 2>nul
    if errorlevel 1 (
      echo Starting local PostgreSQL...
      "%PG_BIN%\pg_ctl.exe" -D "%PG_DATA%" -l "%PG_LOG%" -o "-p 55432" start
    )
    echo Applying migrations and ensuring local login users...
    call cmd /c "cd /d ""%~dp0backend"" && set DATABASE_URL=%APP_DATABASE_URL% && npx prisma migrate deploy && npm run ensure:local-users"
    set "USE_LOCAL_DB=1"
  )
) else (
  echo [WARNING] PostgreSQL binaries not found at:
  echo           %PG_BIN%
  echo Backend will use DATABASE_URL from backend\.env instead.
)

echo Starting backend and frontend...
if "%USE_LOCAL_DB%"=="1" (
  start "Ain El Kharroube - Backend" cmd /k "cd /d ""%~dp0backend"" && set DATABASE_URL=%APP_DATABASE_URL% && set FRONTEND_ORIGIN=%APP_FRONTEND_ORIGINS% && set CLIENT_ORIGIN=%APP_FRONTEND_ORIGINS% && npm run dev"
) else (
  start "Ain El Kharroube - Backend" cmd /k "cd /d ""%~dp0backend"" && set FRONTEND_ORIGIN=%APP_FRONTEND_ORIGINS% && set CLIENT_ORIGIN=%APP_FRONTEND_ORIGINS% && npm run dev"
)
start "Ain El Kharroube - Frontend" cmd /k "cd /d ""%~dp0frontend"" && set API_BASE_URL=%APP_API_URL% && node scripts/write-app-config.cjs && npx ng serve --host 0.0.0.0 --port 4200 --allowed-hosts"

timeout /t 4 /nobreak >nul
start "" "http://localhost:4200"

echo.
echo Local website launch started.
echo Frontend (this PC):   http://localhost:4200
echo Frontend (LAN):       %APP_WEB_URL%
echo Backend API (LAN):    %APP_API_URL%
echo.
echo Default test login:
echo   Email:    admin@municipality.local
echo   Password: ChangeMe123!
echo If this is your first run, install dependencies first:
echo   backend:  npm ci
echo   frontend: npm ci
echo.
exit /b 0
