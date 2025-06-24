# PowerShell Test Runner for User Service
# Usage: ./run-tests.ps1

# Change to user service directory
Set-Location $PSScriptRoot

Write-Host "🚀 Running User Service Tests" -ForegroundColor Green
Write-Host ("=" * 50)

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    npm install
}

# Run unit tests
Write-Host "`n🧪 Running Unit Tests..." -ForegroundColor Cyan
try {
    npm test
    Write-Host "✅ Unit tests completed successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ Unit tests failed" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

# Run integration tests
Write-Host "`n🔗 Running Integration Tests..." -ForegroundColor Cyan
try {
    node run-integration-tests.js
    Write-Host "✅ Integration tests completed successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ Integration tests failed" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

# Health check
Write-Host "`n🔍 Service Health Check..." -ForegroundColor Cyan
try {
    $healthCheck = Invoke-RestMethod -Uri "http://localhost:3012/health" -Method GET -TimeoutSec 5
    if ($healthCheck.status -eq "ok") {
        Write-Host "✅ User service is healthy" -ForegroundColor Green
    } else {
        Write-Host "⚠️ User service responded but status is not ok" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️ User service is not running or not responding" -ForegroundColor Yellow
    Write-Host "💡 Start the service with: npm start" -ForegroundColor Cyan
}

Write-Host "`n🏆 User Service Testing Complete!" -ForegroundColor Green
