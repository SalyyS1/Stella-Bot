function checkHost() {
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "🔧 HELPCHAT BOT SETUP SCRIPT" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Cyan

    Write-Host "[1] Installing NPM Dependencies..." -ForegroundColor Green
    npm install

    Write-Host "[2] Initializing Prisma and SQLite Database..." -ForegroundColor Green
    npx prisma generate
    npx prisma db push

    Write-Host "[3] Building TypeScript Files..." -ForegroundColor Green
    npx tsc

    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "✅ SETUP COMPLETE!" -ForegroundColor Green
    Write-Host "-> Do not forget to put your BOT_TOKEN in the .env file!" -ForegroundColor Yellow
    Write-Host "-> Run the bot using: npm run start" -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Cyan
}

checkHost
