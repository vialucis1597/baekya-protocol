# Baekya Protocol Listing Server Deployment Script

# Set UTF-8 encoding
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "Baekya Protocol Listing Server Deployment Started" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green

# Check Railway CLI installation
$railwayInstalled = Get-Command railway -ErrorAction SilentlyContinue
if (-not $railwayInstalled) {
    Write-Host "ERROR: Railway CLI is not installed." -ForegroundColor Red
    Write-Host "Install with: npm install -g @railway/cli" -ForegroundColor Yellow
    Write-Host "Or PowerShell: iwr -useb https://railway.app/install.ps1 | iex" -ForegroundColor Yellow
    exit 1
}

Write-Host "Railway CLI found" -ForegroundColor Green

# Check Railway login
try {
    $loginStatus = railway whoami 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Railway login required." -ForegroundColor Red
        Write-Host "Please run: railway login" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "ERROR: Railway login required." -ForegroundColor Red
    Write-Host "Please run: railway login" -ForegroundColor Yellow
    exit 1
}

Write-Host "Railway authentication verified" -ForegroundColor Green

# Get project name
$ProjectName = Read-Host "Enter Railway project name for listing server (existing or new)"
if (-not $ProjectName.trim()) {
    Write-Host "ERROR: Project name is required." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Listing Server Configuration:" -ForegroundColor Cyan
Write-Host "  Project: $ProjectName" -ForegroundColor Cyan
Write-Host "  Role: Relay server registry management" -ForegroundColor Cyan
Write-Host "  Port: Auto-assigned by Railway" -ForegroundColor Cyan
Write-Host ""

$confirm = Read-Host "Proceed with listing server deployment? (y/N)"
if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

try {
    Write-Host "Starting listing server deployment..." -ForegroundColor Green
    
    # Check if already linked to a project
    Write-Host "Checking Railway project..." -ForegroundColor Yellow
    
    $railwayConfigExists = Test-Path ".railway"
    if ($railwayConfigExists) {
        Write-Host "Found existing Railway project configuration." -ForegroundColor Green
        $projectStatus = railway status 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Connected to existing project successfully." -ForegroundColor Green
            Write-Host "Current project: " -NoNewline -ForegroundColor Cyan
            Write-Host ($projectStatus | Select-String "Project:").ToString().Split(":")[1].Trim() -ForegroundColor White
            
            $useExisting = Read-Host "Use this existing project? (y/N)"
            if ($useExisting -eq 'y' -or $useExisting -eq 'Y') {
                Write-Host "Using existing project for deployment..." -ForegroundColor Green
            } else {
                # Unlink and show project selection
                railway unlink
                Write-Host "Disconnected from current project." -ForegroundColor Yellow
                $railwayConfigExists = $false
            }
        } else {
            Write-Host "Existing config is invalid. Removing..." -ForegroundColor Yellow
            Remove-Item -Recurse -Force ".railway" -ErrorAction SilentlyContinue
            $railwayConfigExists = $false
        }
    }
    
    if (-not $railwayConfigExists) {
        # Show existing projects
        Write-Host "`nFetching your Railway projects..." -ForegroundColor Yellow
        $projectList = railway list 2>$null
        
        if ($LASTEXITCODE -eq 0 -and $projectList) {
            Write-Host "`nYour existing Railway projects:" -ForegroundColor Cyan
            Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
            
            $projects = @()
            $projectList | ForEach-Object {
                if ($_ -match "^\s*(.+?)\s*$" -and $_.Trim() -ne "" -and $_ -notmatch "^Project") {
                    $projects += $_.Trim()
                }
            }
            
            if ($projects.Count -gt 0) {
                for ($i = 0; $i -lt $projects.Count; $i++) {
                    Write-Host "  $($i + 1). $($projects[$i])" -ForegroundColor White
                }
                Write-Host "  0. Create new project '$ProjectName'" -ForegroundColor Green
                Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
                
                $selection = Read-Host "Select project (0-$($projects.Count))"
                
                if ($selection -eq "0") {
                    Write-Host "Creating new project '$ProjectName'..." -ForegroundColor Yellow
                    railway init --name $ProjectName
                } elseif ($selection -match "^\d+$" -and [int]$selection -ge 1 -and [int]$selection -le $projects.Count) {
                    $selectedProject = $projects[[int]$selection - 1]
                    Write-Host "Connecting to project '$selectedProject'..." -ForegroundColor Green
                    railway link
                } else {
                    Write-Host "Invalid selection. Creating new project '$ProjectName'..." -ForegroundColor Yellow
                    railway init --name $ProjectName
                }
            } else {
                Write-Host "No existing projects found. Creating new project '$ProjectName'..." -ForegroundColor Yellow
                railway init --name $ProjectName
            }
        } else {
            Write-Host "Could not fetch project list. Creating new project '$ProjectName'..." -ForegroundColor Yellow
            railway init --name $ProjectName
        }
    }
    
    # Set environment variables
    Write-Host "Setting environment variables..." -ForegroundColor Yellow
    railway variables --set "NODE_ENV=production"
    railway variables --set "RAILWAY_APP_NAME=$ProjectName"
    
    # Backup and replace package.json
    Write-Host "Preparing deployment configuration..." -ForegroundColor Yellow
    Copy-Item "package.json" "package.json.backup"
    Copy-Item "railway-listing.json" "package.json"
    Copy-Item "Dockerfile" "Dockerfile.backup"
    Copy-Item "Dockerfile.listing" "Dockerfile"
    
    # Deploy
    Write-Host "Deploying to Railway..." -ForegroundColor Yellow
    railway up
    
    # Restore package.json and Dockerfile
    Move-Item "package.json.backup" "package.json" -Force
    Move-Item "Dockerfile.backup" "Dockerfile" -Force
    
    # Check deployment status
    Start-Sleep -Seconds 5
    Write-Host "Checking deployment status..." -ForegroundColor Yellow
    $deployInfo = railway status
    
    Write-Host ""
    Write-Host "Listing Server Deployment Complete!" -ForegroundColor Green
    Write-Host "===================================" -ForegroundColor Green
    Write-Host "Deployment Info:" -ForegroundColor Cyan
    Write-Host $deployInfo
    Write-Host ""
    Write-Host "SUCCESS: Listing server deployed successfully!" -ForegroundColor Yellow
    Write-Host "Relay servers will now auto-register with this listing server!" -ForegroundColor Yellow
    Write-Host "Railway Dashboard: https://railway.app/dashboard" -ForegroundColor Yellow
    
} catch {
    Write-Host "ERROR during deployment: $($_.Exception.Message)" -ForegroundColor Red
    
    # Restore files on error
    if (Test-Path "package.json.backup") {
        Move-Item "package.json.backup" "package.json" -Force
    }
    if (Test-Path "Dockerfile.backup") {
        Move-Item "Dockerfile.backup" "Dockerfile" -Force
    }
    
    exit 1
}

Write-Host ""
Write-Host "Listing server deployment completed successfully" -ForegroundColor Green