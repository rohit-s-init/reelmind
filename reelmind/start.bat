@echo off
REM ReelMind: stop the old server, start a fresh one, open it in the browser.
REM Double-click this file, or run "start.bat" in a terminal. Press Ctrl+C to stop.

setlocal
set PORT=8000
cd /d "%~dp0"

echo.
echo === ReelMind ===

REM 1. Stop anything already running on the port
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
    echo Stopping old server ^(process %%p^)...
    taskkill /F /PID %%p >nul 2>&1
)

REM 2. First run only: create the Python environment and install packages
if not exist ".venv\Scripts\python.exe" (
    echo Setting up Python environment ^(first run only^)...
    python -m venv .venv || goto :error
    ".venv\Scripts\python" -m pip install -q -r requirements.txt || goto :error
)

REM 3. First run only: train the model on MovieLens
if not exist "artifacts\metrics.json" (
    echo Training the model on MovieLens ^(about 30 seconds^)...
    ".venv\Scripts\python" train.py || goto :error
)

REM 4. Open the browser once the server has had a few seconds to start
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:%PORT%"

REM 5. Start the server (keeps running in this window)
echo Starting server at http://localhost:%PORT%  ^(Ctrl+C to stop^)
".venv\Scripts\python" -m uvicorn app:app --port %PORT%
goto :eof

:error
echo.
echo Something went wrong - see the message above.
pause
