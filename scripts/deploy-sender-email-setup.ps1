# PowerShell deployment script for sender email setup feature
# This script handles the deployment of infrastructure changes for the sender email setup feature

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("sandbox", "stage", "production")]
    [string]$Environment
)

# Function to write colored output
function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

Write-Status "Starting deployment for sender email setup feature to $Environment environment"

# Check prerequisites
Write-Status "Checking prerequisites..."

# Check if AWS CLI is installed
try {
    aws --version | Out-Null
} catch {
    Write-Error "AWS CLI is not installed. Please install it first."
    exit 1
}

# Check if SAM CLI is installed
try {
    sam --version | Out-Null
} catch {
    Write-Error "SAM CLI is not installed. Please install it first."
    exit 1
}

# Check if Node.js is installed
try {
    node --version | Out-Null
} catch {
    Write-Error "Node.js is not installed. Please install it first."
    exit 1
}

# Check AWS credentials
try {
    aws sts get-caller-identity | Out-Null
} catch {
    Write-Error "AWS credentials are not configured or invalid."
    exit 1
}

Write-Status "Prerequisites check passed"

# Install dependencies
Write-Status "Installing dependencies..."
npm ci

# Run tests before deployment
Write-Status "Running tests..."
npm run test

# Run linting
Write-Status "Running linting..."
npm run lint

Write-Status "Pre-deployment checks passed"

# Build the application
Write-Status "Building application..."
sam build --parallel

# Deploy based on environment
Write-Status "Deploying to $Environment environment..."

switch ($Environment) {
    "sandbox" {
        sam deploy --config-env default --no-fail-on-empty-changeset
    }
    "stage" {
        $encryptionKey = $env:ENCRYPTION_KEY
        if (-not $encryptionKey) { $encryptionKey = "default-stage-key" }

        $momentoCacheName = $env:MOMENTO_CACHE_NAME
        if (-not $momentoCacheName) { $momentoCacheName = "newsletter" }

        $momentoApiKey = $env:MOMENTO_API_KEY
        if (-not $momentoApiKey) {
            Write-Error "MOMENTO_API_KEY environment variable is required for stage deployment"
            exit 1
        }

        sam deploy `
            --stack-name newsletter-service `
            --resolve-s3 `
            --no-fail-on-empty-changeset `
            --capabilities CAPABILITY_IAM `
            --parameter-overrides `
                Environment=stage `
                EncryptionKey=$encryptionKey `
                MomentoCacheName=$momentoCacheName `
                MomentoApiKey=$momentoApiKey
    }
    "production" {
        # Additional confirmation for production
        Write-Warning "You are about to deploy to PRODUCTION environment."
        $confirm = Read-Host "Are you sure you want to continue? (yes/no)"
        if ($confirm -ne "yes") {
            Write-Status "Deployment cancelled"
            exit 0
        }

        $encryptionKey = $env:ENCRYPTION_KEY
        if (-not $encryptionKey) {
            Write-Error "ENCRYPTION_KEY environment variable is required for production deployment"
            exit 1
        }

        $momentoCacheName = $env:MOMENTO_CACHE_NAME
        if (-not $momentoCacheName) { $momentoCacheName = "newsletter" }

        $momentoApiKey = $env:MOMENTO_API_KEY
        if (-not $momentoApiKey) {
            Write-Error "MOMENTO_API_KEY environment variable is required for production deployment"
            exit 1
        }

        $redirectCustomDomain = $env:REDIRECT_CUSTOM_DOMAIN
        if (-not $redirectCustomDomain) { $redirectCustomDomain = "rdyset.click" }

        sam deploy `
            --stack-name newsletter-service `
            --resolve-s3 `
            --no-fail-on-empty-changeset `
            --capabilities CAPABILITY_IAM `
            --parameter-overrides `
                Environment=production `
                EncryptionKey=$encryptionKey `
                MomentoCacheName=$momentoCacheName `
                MomentoApiKey=$momentoApiKey `
                RedirectCustomDomain=$redirectCustomDomain
    }
}

# Verify deployment
Write-Status "Verifying deployment..."

# Get stack outputs
$stackName = "newsletter-service"
try {
    $apiUrl = aws cloudformation describe-stacks --stack-name $stackName --query 'Stacks[0].Outputs[?OutputKey==`NewsletterApiUrl`].OutputValue' --output text

    if ($apiUrl) {
        Write-Status "Deployment successful!"
        Write-Status "API URL: $apiUrl"

        # Test basic API connectivity
        Write-Status "Testing API connectivity..."
        try {
            $response = Invoke-WebRequest -Uri "$apiUrl/health" -Method GET -TimeoutSec 10
            if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 404) {
                Write-Status "API is responding"
            }
        } catch {
            Write-Warning "API might not be fully ready yet. This is normal for new deployments."
        }
    } else {
        Write-Error "Could not retrieve API URL from stack outputs"
        exit 1
    }
} catch {
    Write-Error "Error verifying deployment: $_"
    exit 1
}

Write-Status "Sender email setup feature deployment completed successfully!"

# Display next steps
Write-Host ""
Write-Status "Next steps:"
Write-Host "1. Verify sender email functions are working by testing the API endpoints"
Write-Host "2. Check CloudWatch logs for any errors"
Write-Host "3. Test the frontend integration"
Write-Host "4. Monitor SES configuration set events"

# Display important URLs and resources
Write-Host ""
Write-Status "Important resources:"
Write-Host "- API Base URL: $apiUrl"
Write-Host "- CloudWatch Logs: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups"
Write-Host "- SES Console: https://console.aws.amazon.com/ses/home?region=us-east-1"
Write-Host "- DynamoDB Tables: https://console.aws.amazon.com/dynamodb/home?region=us-east-1#tables"
