@echo off
echo ===== Starting Auth Service for Development =====

cd backend\auth-service

echo Installing dependencies...
call npm install

echo Starting service on port 3011...
call npm run dev

pause
