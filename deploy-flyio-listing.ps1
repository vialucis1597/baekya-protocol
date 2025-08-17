# Baekya Protocol Listing Server Fly.io Deployment Script

# Set UTF-8 encoding
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "Baekya Protocol Listing Server Fly.io Deployment Started" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green

# Check Fly CLI installation
$flyInstalled = Get-Command fly -ErrorAction SilentlyContinue
if (-not $flyInstalled) {
    Write-Host "ERROR: Fly CLI is not installed." -ForegroundColor Red
    Write-Host "Install with: pwsh -c `"iwr https://fly.io/install.ps1 -useb | iex`"" -ForegroundColor Yellow
    Write-Host "Or visit: https://fly.io/docs/hands-on/install-flyctl/" -ForegroundColor Yellow
    exit 1
}

Write-Host "Fly CLI found" -ForegroundColor Green

# Check Fly authentication
try {
    $authStatus = fly auth whoami 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Fly authentication required." -ForegroundColor Red
        Write-Host "Please run: fly auth login" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "ERROR: Fly authentication required." -ForegroundColor Red
    Write-Host "Please run: fly auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "Fly authentication verified: $authStatus" -ForegroundColor Green

# Get app name
$AppName = Read-Host "Enter Fly.io app name for listing server (will be created if doesn't exist)"
if (-not $AppName.trim()) {
    Write-Host "ERROR: App name is required." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Listing Server Configuration:" -ForegroundColor Cyan
Write-Host "  App Name: $AppName" -ForegroundColor Cyan
Write-Host "  Region: Tokyo (nrt) - Optimal for Asia" -ForegroundColor Cyan
Write-Host "  Role: Relay server registry management" -ForegroundColor Cyan
Write-Host "  Port: 4000" -ForegroundColor Cyan
Write-Host ""

$confirm = Read-Host "Proceed with listing server deployment? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

try {
    Write-Host "Starting listing server deployment..." -ForegroundColor Green
    
    # Check if app exists
    Write-Host "Checking if app exists..." -ForegroundColor Yellow
    $appExists = fly apps list 2>$null | Select-String $AppName
    
    if (-not $appExists) {
        Write-Host "Creating new Fly.io app: $AppName" -ForegroundColor Yellow
        fly apps create $AppName --org personal
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create Fly.io app"
        }
    } else {
        Write-Host "App '$AppName' already exists" -ForegroundColor Green
    }
    
    # Backup and prepare deployment files
    Write-Host "Preparing deployment configuration..." -ForegroundColor Yellow
    
    # Backup original files
    if (Test-Path "fly.toml") {
        Copy-Item "fly.toml" "fly.toml.backup"
    }
    if (Test-Path "Dockerfile") {
        Copy-Item "Dockerfile" "Dockerfile.backup"
    }
    if (Test-Path "package.json") {
        Copy-Item "package.json" "package.json.backup"
    }
    if (Test-Path ".dockerignore") {
        Copy-Item ".dockerignore" ".dockerignore.backup"
    }
    
    # Use Fly.io specific files
    Copy-Item "fly-listing.toml" "fly.toml"
    Copy-Item "Dockerfile.flyio.listing" "Dockerfile"
    Copy-Item "railway-listing.json" "package.json"
    Copy-Item ".dockerignore.listing" ".dockerignore"
    
    # Update app name in fly.toml
    (Get-Content "fly.toml") -replace 'app = "baekya-listing-server"', "app = `"$AppName`"" | Set-Content "fly.toml"
    
    # Set secrets/environment variables
    Write-Host "Setting environment variables..." -ForegroundColor Yellow
    fly secrets set NODE_ENV=production --app $AppName
    
    # Deploy to Fly.io
    Write-Host "Deploying to Fly.io..." -ForegroundColor Yellow
    fly deploy --app $AppName
    
    if ($LASTEXITCODE -ne 0) {
        throw "Deployment failed"
    }
    
    # Check and cleanup extra machines
    Write-Host "Checking machine count..." -ForegroundColor Yellow
    $machines = fly machines list --app $AppName --json | ConvertFrom-Json
    if ($machines.Count -gt 1) {
        Write-Host "Found $($machines.Count) machines. Keeping only the latest one..." -ForegroundColor Yellow
        $latestMachine = $machines | Sort-Object created_at -Descending | Select-Object -First 1
        $extraMachines = $machines | Where-Object { $_.id -ne $latestMachine.id }
        
        foreach ($machine in $extraMachines) {
            Write-Host "Removing extra machine: $($machine.id)" -ForegroundColor Yellow
            fly machines remove $machine.id --app $AppName --force
        }
    } else {
        Write-Host "Machine count is optimal: $($machines.Count)" -ForegroundColor Green
    }
    
    # Restore original files
    Write-Host "Restoring original configuration files..." -ForegroundColor Yellow
    
    if (Test-Path "fly.toml.backup") {
        Move-Item "fly.toml.backup" "fly.toml" -Force
    } else {
        Remove-Item "fly.toml" -Force -ErrorAction SilentlyContinue
    }
    
    if (Test-Path "Dockerfile.backup") {
        Move-Item "Dockerfile.backup" "Dockerfile" -Force
    }
    
    if (Test-Path "package.json.backup") {
        Move-Item "package.json.backup" "package.json" -Force
    }
    
    if (Test-Path ".dockerignore.backup") {
        Move-Item ".dockerignore.backup" ".dockerignore" -Force
    } else {
        Remove-Item ".dockerignore" -Force -ErrorAction SilentlyContinue
    }
    
    # Get app info
    Write-Host "Getting deployment information..." -ForegroundColor Yellow
    $appInfo = fly apps list | Select-String $AppName
    $appUrl = "https://$AppName.fly.dev"
    
    Write-Host ""
    Write-Host "Listing Server Deployment Complete!" -ForegroundColor Green
    Write-Host "===================================" -ForegroundColor Green
    Write-Host "App Name: $AppName" -ForegroundColor Cyan
    Write-Host "URL: $appUrl" -ForegroundColor Cyan
    Write-Host "Health Check: $appUrl/health" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "SUCCESS: Listing server deployed successfully!" -ForegroundColor Yellow
    Write-Host "Relay servers will now auto-register with this listing server!" -ForegroundColor Yellow
    Write-Host "Fly.io Dashboard: https://fly.io/dashboard" -ForegroundColor Yellow
    
} catch {
    Write-Host "ERROR during deployment: $($_.Exception.Message)" -ForegroundColor Red
    
    # Restore files on error
    Write-Host "Restoring original files due to error..." -ForegroundColor Yellow
    
    if (Test-Path "fly.toml.backup") {
        Move-Item "fly.toml.backup" "fly.toml" -Force
    } else {
        Remove-Item "fly.toml" -Force -ErrorAction SilentlyContinue
    }
    
    if (Test-Path "Dockerfile.backup") {
        Move-Item "Dockerfile.backup" "Dockerfile" -Force
    }
    
    if (Test-Path "package.json.backup") {
        Move-Item "package.json.backup" "package.json" -Force
    }
    
    if (Test-Path ".dockerignore.backup") {
        Move-Item ".dockerignore.backup" ".dockerignore" -Force
    } else {
        Remove-Item ".dockerignore" -Force -ErrorAction SilentlyContinue
    }
    
    exit 1
}

Write-Host ""
Write-Host "Listing server Fly.io deployment completed successfully" -ForegroundColor Green

