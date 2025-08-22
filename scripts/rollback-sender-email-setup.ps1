# PowerShell rollback script for sender email setup feature
# This script handles the rollback of infrastructure changes for the sender email setup feature

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

$StackName = "newsletter-service"

Write-Warning "Starting rollback for sender email setup feature in $Environment environment"

# Additional confirmation for production
if ($Environment -eq "production") {
    Write-Warning "You are about to rollback changes in PRODUCTION environment."
    Write-Warning "This will:"
    Write-Host "  - Remove sender email management functions"
    Write-Host "  - Remove SES configuration set event destinations"
    Write-Host "  - Potentially affect existing sender email configurations"
    Write-Host ""
    $confirm = Read-Host "Are you sure you want to continue? (yes/no)"
    if ($confirm -ne "yes") {
        Write-Status "Rollback cancelled"
        exit 0
    }
}

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

# Check AWS credentials
try {
    aws sts get-caller-identity | Out-Null
} catch {
    Write-Error "AWS credentials are not configured or invalid."
    exit 1
}

# Check if stack exists
try {
    aws cloudformation describe-stacks --stack-name $StackName | Out-Null
} catch {
    Write-Error "Stack $StackName does not exist"
    exit 1
}

Write-Status "Prerequisites check p"

# Create backup of current sender data (optional)
Write-Status "Creating backup of current sender email data..."

# Get table name from stack
$TableName = ""
try {
    $TableName = aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs[?OutputKey==`NewsletterTable`].OutputValue' --output text
} catch {
    Write-Warning "Could not determine table name for backup"
}

if ($TableName -and $TableName -ne "None") {
    $BackupFile = "sender-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    Write-Status "Backing up sender data to $BackupFile..."

    try {
        aws dynamodb scan --table-name $TableName --filter-expression "begins_with(sk, :sk_prefix)" --expression-attribute-values '{":sk_prefix":{"S":"sender#"}}' --output json | Out-File -FilePath $BackupFile -Encoding UTF8

        if (Test-Path $BackupFile) {
            Write-Status "Backup created: $BackupFile"
        }
    } catch {
        Write-Warning "Could not create backup of sender data: $($_.Exception.Message)"
    }
} else {
    Write-Warning "Could not determine table name for backup"
}

# Rollback strategy options
Write-Host ""
Write-Status "Rollback options:"
Write-Host "1. Remove only sender email functions (recommended)"
Write-Host "2. Full rollback to previous template version"
Write-Host "3. Manual cleanup of specific resources"
Write-Host ""
$rollbackOption = Read-Host "Select rollback option (1-3)"

switch ($rollbackOption) {
    "1" {
        Write-Status "Performing selective rollback of sender email functions..."

        # Create a temporary template without sender functions
        Write-Status "Creating rollback template..."

        # This would require a previous version of the template without sender functions
        # For now, we'll provide instructions for manual cleanup
        Write-Warning "Selective rollback requires manual template modification."
        Write-Status "To perform selective rollback:"
        Write-Host "1. Comment out or remove sender email functions from template.yaml"
        Write-Host "2. Run: sam build && sam deploy"
        Write-Host "3. Verify that sender functions are removed from AWS Lambda console"
    }

    "2" {
        Write-Status "Performing full rollback..."
        Write-Warning "This will rollback ALL recent changes, not just sender email setup"

        # Get previous stack template
        Write-Status "Retrieving previous stack template..."

        # This is a placeholder - in a real scenario, you'd have versioned templates
        Write-Error "Full rollback requires a previous template version."
        Write-Status "To perform full rollback:"
        Write-Host "1. Checkout previous git commit with working template"
        Write-Host "2. Run: sam build && sam deploy"
        Write-Host "3. Verify all resources are restored"
    }

    "3" {
        Write-Status "Manual cleanup mode..."
        Write-Status "Resources to clean up manually:"
        Write-Host ""
        Write-Host "Lambda Functions:"
        Write-Host "- GetSendersFunction"
        Write-Host "- CreateSenderFunction"
        Write-Host "- UpdateSenderFunction"
        Write-Host "- DeleteSenderFunction"
        Write-Host "- VerifyDomainFunction"
        Write-Host "- GetDomainVerificationFunction"
        Write-Host "- HandleSESEventFunction"
        Write-Host ""
        Write-Host "API Gateway Endpoints:"
        Write-Host "- GET /senders"
        Write-Host "- POST /senders"
        Write-Host "- PUT /senders/{senderId}"
        Write-Host "- DELETE /senders/{senderId}"
        Write-Host "- POST /senders/verify-domain"
        Write-Host "- GET /senders/domain-verification/{domain}"
        Write-Host ""
        Write-Host "EventBridge Rules:"
        Write-Host "- SES Identity Verification Result events"
        Write-Host ""
        Write-Host "DynamoDB Data:"
        Write-Host "- Records with sk starting with 'sender#'"
        Write-Host "- Records with sk starting with 'domain#'"
    }

    default {
        Write-Error "Invalid option selected"
        exit 1
    }
}

# Cleanup SES identities (optional)
Write-Host ""
$cleanupSes = Read-Host "Do you want to clean up SES identities created by sender email setup? (yes/no)"

if ($cleanupSes -eq "yes") {
    Write-Warning "Cleaning up SES identities..."
    Write-Warning "This will remove email verification for sender addresses!"

    # List and optionally remove SES identities
    Write-Status "Listing SES identities..."
    try {
        aws ses list-identities --output table
    } catch {
        Write-Warning "Could not list SES identities: $($_.Exception.Message)"
    }

    Write-Host ""
    Write-Warning "Manual cleanup required for SES identities."
    Write-Status "To clean up SES identities:"
    Write-Host "1. Go to SES Console: https://console.aws.amazon.com/ses/"
    Write-Host "2. Navigate to 'Verified identities'"
    Write-Host "3. Remove identities that were created for sender email setup"
    Write-Host "4. Check configuration sets for any sender-specific configurations"
}

# Final verification
Write-Host ""
Write-Status "Rollback process completed."
Write-Status "Please verify the following:"
Write-Host "1. Check AWS Lambda console to ensure sender functions are removed"
Write-Host "2. Verify API Gateway endpoints are cleaned up"
Write-Host "3. Check DynamoDB for any remaining sender data"
Write-Host "4. Verify SES identities are cleaned up if requested"
Write-Host "5. Test that the application still works without sender email functionality"

# Display monitoring recommendations
Write-Host ""
Write-Status "Post-rollback monitoring:"
Write-Host "1. Monitor CloudWatch logs for any errors"
Write-Host "2. Check application functionality"
Write-Host "3. Verify no broken references to sender email functions"
Write-Host "4. Monitor SES usage and configuration"

Write-Status "Rollback procedure completed!"
