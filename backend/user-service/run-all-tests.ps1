# User Service Comprehensive Test Runner - PowerShell Version
# Run this script with: .\run-all-tests.ps1

Write-Host "🚀 Starting User Service Comprehensive Test Suite" -ForegroundColor Green
Write-Host ("=" * 60) -ForegroundColor Yellow

# Change to user service directory
Set-Location $PSScriptRoot

# Test configurations
$testConfigs = @(
    @{
        Name = "Unit Tests"
        Command = "npm"
        Args = @("test")
        Description = "Core functionality and API endpoint tests"
    },
    @{
        Name = "Integration Tests" 
        Command = "node"
        Args = @("run-integration-tests.js")
        Description = "Cross-service integration and end-to-end flows"
    }
)

$totalTests = 0
$passedTests = 0
$failedTests = 0
$results = @()

foreach ($config in $testConfigs) {
    Write-Host "`n📋 Running $($config.Name)..." -ForegroundColor Cyan
    Write-Host "📝 $($config.Description)" -ForegroundColor Gray
    Write-Host ("-" * 40) -ForegroundColor Gray
    
    try {
        $startTime = Get-Date
        
        # Run the command
        $process = Start-Process -FilePath $config.Command -ArgumentList $config.Args -Wait -PassThru -RedirectStandardOutput "temp_output.txt" -RedirectStandardError "temp_error.txt"
        
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        
        if ($process.ExitCode -eq 0) {
            $output = Get-Content "temp_output.txt" -Raw
            
            # Parse Jest output to get test counts
            if ($output -match "Tests:\s+(\d+)\s+passed") {
                $testsCount = [int]$matches[1]
            } else {
                $testsCount = 1
            }
            
            Write-Host "✅ $($config.Name) completed successfully in $($duration.ToString('F2'))s" -ForegroundColor Green
            Write-Host "📊 Tests passed: $testsCount" -ForegroundColor Green
            
            $totalTests += $testsCount
            $passedTests += $testsCount
            
            $results += @{
                Name = $config.Name
                Status = "PASSED"
                TestsCount = $testsCount
                Duration = $duration.ToString('F2')
                Output = ($output -split "`n")[-10..-1] -join "`n"
            }
        } else {
            throw "Process exited with code $($process.ExitCode)"
        }
        
    } catch {
        Write-Host "❌ $($config.Name) failed" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        
        # Try to read error output
        $errorOutput = ""
        if (Test-Path "temp_error.txt") {
            $errorOutput = Get-Content "temp_error.txt" -Raw
        }
        
        # Try to extract test counts from error output
        $failed = 1
        $passed = 0
        if ($errorOutput -match "Tests:\s+(\d+)\s+failed") {
            $failed = [int]$matches[1]
        }
        if ($errorOutput -match "Tests:\s+(\d+)\s+passed") {
            $passed = [int]$matches[1]
        }
        
        $totalTests += ($failed + $passed)
        $passedTests += $passed
        $failedTests += $failed
        
        $results += @{
            Name = $config.Name
            Status = "FAILED"
            TestsCount = $failed + $passed
            Failed = $failed
            Passed = $passed
            Error = $_.Exception.Message
            Output = $errorOutput
        }
    } finally {
        # Clean up temp files
        Remove-Item "temp_output.txt" -ErrorAction SilentlyContinue
        Remove-Item "temp_error.txt" -ErrorAction SilentlyContinue
    }
}

# Print comprehensive summary
Write-Host "`n$('=' * 60)" -ForegroundColor Yellow
Write-Host "🏆 USER SERVICE TEST SUMMARY" -ForegroundColor Green
Write-Host ("=" * 60) -ForegroundColor Yellow

Write-Host "`n📊 Overall Statistics:" -ForegroundColor Cyan
Write-Host "   Total Tests: $totalTests"
Write-Host "   Passed: $passedTests ✅" -ForegroundColor Green
Write-Host "   Failed: $failedTests ❌" -ForegroundColor Red
$successRate = if ($totalTests -gt 0) { [math]::Round(($passedTests / $totalTests) * 100, 1) } else { 0 }
Write-Host "   Success Rate: $successRate%"

Write-Host "`n📋 Detailed Results:" -ForegroundColor Cyan
for ($i = 0; $i -lt $results.Count; $i++) {
    $result = $results[$i]
    Write-Host "`n$($i + 1). $($result.Name): $($result.Status)"
    if ($result.Status -eq "PASSED") {
        Write-Host "   ✅ $($result.TestsCount) tests passed in $($result.Duration)s" -ForegroundColor Green
    } else {
        Write-Host "   ❌ $($result.Failed) failed, $($result.Passed) passed" -ForegroundColor Red
        if ($result.Error) {
            $errorPreview = $result.Error.Substring(0, [Math]::Min(100, $result.Error.Length))
            Write-Host "   Error: $errorPreview..." -ForegroundColor Red
        }
    }
}

# Service health check
Write-Host "`n🔍 Service Health Check:" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3012/health" -Method Get -TimeoutSec 5
    if ($health.status -eq "ok") {
        Write-Host "   ✅ User service is running and healthy" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  User service returned unexpected status: $($health.status)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ⚠️  User service is not running or not responding" -ForegroundColor Yellow
    Write-Host "   💡 Start with: npm start" -ForegroundColor Gray
}

# Recommendations
Write-Host "`n💡 Next Steps:" -ForegroundColor Cyan
if ($failedTests -gt 0) {
    Write-Host "   🔧 Fix failing tests before proceeding" -ForegroundColor Red
    Write-Host "   📝 Check detailed error messages above" -ForegroundColor Gray
    Write-Host "   🚀 Rerun tests with: npm test" -ForegroundColor Gray
} else {
    Write-Host "   ✅ All tests passing - User Service is ready!" -ForegroundColor Green
    Write-Host "   🚀 Ready to proceed with Fund Service implementation" -ForegroundColor Green
    Write-Host "   📊 Integration with Auth and Notification services verified" -ForegroundColor Green
}

Write-Host "`n🔗 Available Commands:" -ForegroundColor Cyan
Write-Host "   npm start          - Start the user service" -ForegroundColor Gray
Write-Host "   npm test           - Run unit tests" -ForegroundColor Gray
Write-Host "   npm run dev        - Start in development mode" -ForegroundColor Gray
Write-Host "   npm run test:watch - Run tests in watch mode" -ForegroundColor Gray

Write-Host "`n$('=' * 60)" -ForegroundColor Yellow

# Exit with appropriate code
if ($failedTests -gt 0) {
    exit 1
} else {
    exit 0
}
