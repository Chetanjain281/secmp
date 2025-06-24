@echo off
echo 🚀 User Service Test Runner (Windows Batch)
echo ========================================

cd /d "%~dp0"
echo 📁 Current directory: %CD%

echo.
echo 📦 Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ❌ npm install failed
    pause
    exit /b 1
)

echo.
echo 🧪 Running unit tests...
call npm test
if %ERRORLEVEL% neq 0 (
    echo ❌ Unit tests failed
    pause
    exit /b 1
)

echo.
echo 🔗 Running integration tests...
call node run-integration-tests.js
if %ERRORLEVEL% neq 0 (
    echo ❌ Integration tests failed
    pause
    exit /b 1
)

echo.
echo ✅ All tests completed successfully!
echo 🚀 User Service is ready for deployment

echo.
echo 💡 Available commands:
echo    npm start          - Start the user service
echo    npm run dev        - Start in development mode
echo    npm test           - Run unit tests only
echo    npm run test:watch - Run tests in watch mode

pause
