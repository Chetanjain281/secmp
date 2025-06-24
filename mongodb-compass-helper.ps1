# MongoDB Connection Helper for Compass
# This script will help you connect to MongoDB Compass correctly

Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║           Marketplace - MongoDB Compass Connection            ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host

# Check if MongoDB is running
Write-Host "1. Checking if MongoDB is running in Docker..." -ForegroundColor Yellow
try {
    $mongoContainer = docker ps -f "name=marketplace-mongodb" --format "{{.Names}} ({{.Status}})"
    if ($mongoContainer) {
        Write-Host "   ✅ MongoDB container is running: $mongoContainer" -ForegroundColor Green
    } else {
        Write-Host "   ❌ MongoDB container not found! Make sure to run 'docker-compose up -d'" -ForegroundColor Red
        Write-Host "   Running 'docker-compose up -d mongodb' for you..." -ForegroundColor Yellow
        docker-compose up -d mongodb
        Start-Sleep -Seconds 5
        $mongoContainer = docker ps -f "name=marketplace-mongodb" --format "{{.Names}} ({{.Status}})"
        if ($mongoContainer) {
            Write-Host "   ✅ MongoDB container is now running: $mongoContainer" -ForegroundColor Green
        } else {
            Write-Host "   ❌ Still couldn't start MongoDB container" -ForegroundColor Red
            exit
        }
    }
} catch {
    Write-Host "   ❌ Error checking Docker containers. Is Docker running?" -ForegroundColor Red
    Write-Host "      Error: $_" -ForegroundColor Red
    exit
}

Write-Host
Write-Host "2. MongoDB Connection Information:" -ForegroundColor Yellow
Write-Host "   Host: localhost"
Write-Host "   Port: 27017"
Write-Host "   Database: marketplace"

Write-Host
Write-Host "3. Connection String for MongoDB Compass:" -ForegroundColor Yellow
Write-Host "   mongodb://localhost:27017/marketplace" -ForegroundColor Green

Write-Host
Write-Host "4. How to connect in MongoDB Compass:"
Write-Host "   a) Open MongoDB Compass"
Write-Host "   b) In the connection field, paste: mongodb://admin:password123@localhost:27017/?authSource=admin"
Write-Host "   c) Click 'Connect'"
Write-Host "   d) Look for the 'marketplace' database in the left sidebar"

Write-Host
Write-Host "5. Troubleshooting:"
Write-Host "   - Make sure Docker and the MongoDB container are running"
Write-Host "   - If you get 'Authentication failed', double check your username and password"
Write-Host "   - Try connecting without authentication first (Option 3 above)"
Write-Host "   - Check if MongoDB is listening on all interfaces in your Docker setup"

Write-Host
Write-Host "Would you like to test a direct connection to MongoDB?"
$response = Read-Host "Type 'yes' or 'no'"

if ($response -eq "yes") {
    Write-Host "Testing direct connection to MongoDB..."
    try {
        # This requires MongoDB command line tools, which might not be installed
        # You can use mongoose or another method to test the connection
        Write-Host "Please run 'node troubleshoot-mongodb.js' to test the connection"
    } catch {
        Write-Host "Error testing MongoDB connection: $_"
    }
}
