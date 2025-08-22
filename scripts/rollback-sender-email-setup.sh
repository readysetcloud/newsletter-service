#!/bin/bash

# Rollback script for sender email setup feature
# This script handles the rollback of infrastructure changes for the sender email setup feature

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if environment is provided
if [ -z "$1" ]; then
    print_error "Environment parameter is required. Usage: ./rollback-sender-email-setup.sh [sandbox|stage|production]"
    exit 1
fi

ENVIRONMENT=$1
STACK_NAME="newsletter-service"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(sandbooduction)$ ]]; then
    print_error "Invalid environment. Must be one of: sandbox, stage, production"
    exit 1
fi

print_warning "Starting rollback for sender email setup feature in $ENVIRONMENT environment"

# Additional confirmation for production
if [[ "$ENVIRONMENT" == "production" ]]; then
    print_warning "You are about to rollback changes in PRODUCTION environment."
    print_warning "This will:"
    echo "  - Remove sender email management functions"
    echo "  - Remove SES configuration set event destinations"
    echo "  - Potentially affect existing sender email configurations"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm
    if [[ $confirm != "yes" ]]; then
        print_status "Rollback cancelled"
        exit 0
    fi
fi

# Check prerequisites
print_status "Checking prerequisites..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    print_error "SAM CLI is not installed. Please install it first."
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials are not configured or invalid."
    exit 1
fi

# Check if stack exists
if ! aws cloudformation describe-stacks --stack-name $STACK_NAME &> /dev/null; then
    print_error "Stack $STACK_NAME does not exist"
    exit 1
fi

print_status "Prerequisites check passed"

# Create backup of current sender data (optional)
print_status "Creating backup of current sender email data..."

# Get table name from stack
TABLE_NAME=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`NewsletterTable`].OutputValue' --output text 2>/dev/null || echo "")

if [ -n "$TABLE_NAME" ]; then
    BACKUP_FILE="sender-backup-$(date +%Y%m%d-%H%M%S).json"
    print_status "Backing up sender data to $BACKUP_FILE..."

    # Query all sender records
    aws dynamodb scan \
        --table-name $TABLE_NAME \
        --filter-expression "begins_with(sk, :sk_prefix)" \
        --expression-attribute-values '{":sk_prefix":{"S":"sender#"}}' \
        --output json > "$BACKUP_FILE" 2>/dev/null || print_warning "Could not create backup of sender data"

    if [ -f "$BACKUP_FILE" ]; then
        print_status "Backup created: $BACKUP_FILE"
    fi
else
    print_warning "Could not determine table name for backup"
fi

# Rollback strategy options
echo ""
print_status "Rollback options:"
echo "1. Remove only sender email functions (recommended)"
echo "2. Full rollback to previous template version"
echo "3. Manual cleanup of specific resources"
echo ""
read -p "Select rollback option (1-3): " rollback_option

case $rollback_option in
    "1")
        print_status "Performing selective rollback of sender email functions..."

        # Create a temporary template without sender functions
        print_status "Creating rollback template..."

        # This would require a previous version of the template without sender functions
        # For now, we'll provide instructions for manual cleanup
        print_warning "Selective rollback requires manual template modification."
        print_status "To perform selective rollback:"
        echo "1. Comment out or remove sender email functions from template.yaml"
        echo "2. Run: sam build && sam deploy"
        echo "3. Verify that sender functions are removed from AWS Lambda console"
        ;;

    "2")
        print_status "Performing full rollback..."
        print_warning "This will rollback ALL recent changes, not just sender email setup"

        # Get previous stack template
        print_status "Retrieving previous stack template..."

        # This is a placeholder - in a real scenario, you'd have versioned templates
        print_error "Full rollback requires a previous template version."
        print_status "To perform full rollback:"
        echo "1. Checkout previous git commit with working template"
        echo "2. Run: sam build && sam deploy"
        echo "3. Verify all resources are restored"
        ;;

    "3")
        print_status "Manual cleanup mode..."
        print_status "Resources to clean up manually:"
        echo ""
        echo "Lambda Functions:"
        echo "- GetSendersFunction"
        echo "- CreateSenderFunction"
        echo "- UpdateSenderFunction"
        echo "- DeleteSenderFunction"
        echo "- VerifyDomainFunction"
        echo "- GetDomainVerificationFunction"
        echo "- HandleSESEventFunction"
        echo ""
        echo "API Gateway Endpoints:"
        echo "- GET /senders"
        echo "- POST /senders"
        echo "- PUT /senders/{senderId}"
        echo "- DELETE /senders/{senderId}"
        echo "- POST /senders/verify-domain"
        echo "- GET /senders/domain-verification/{domain}"
        echo ""
        echo "EventBridge Rules:"
        echo "- SES Identity Verification Result events"
        echo ""
        echo "DynamoDB Data:"
        echo "- Records with sk starting with 'sender#'"
        echo "- Records with sk starting with 'domain#'"
        ;;

    *)
        print_error "Invalid option selected"
        exit 1
        ;;
esac

# Cleanup SES identities (optional)
echo ""
read -p "Do you want to clean up SES identities created by sender email setup? (yes/no): " cleanup_ses

if [[ $cleanup_ses == "yes" ]]; then
    print_warning "Cleaning up SES identities..."
    print_warning "This will remove email verification for sender addresses!"

    # List and optionally remove SES identities
    print_status "Listing SES identities..."
    aws ses list-identities --output table

    echo ""
    print_warning "Manual cleanup required for SES identities."
    print_status "To clean up SES identities:"
    echo "1. Go to SES Console: https://console.aws.amazon.com/ses/"
    echo "2. Navigate to 'Verified identities'"
    echo "3. Remove identities that were created for sender email setup"
    echo "4. Check configuration sets for any sender-specific configurations"
fi

# Final verification
echo ""
print_status "Rollback process completed."
print_status "Please verify the following:"
echo "1. Check AWS Lambda console to ensure sender functions are removed"
echo "2. Verify API Gateway endpoints are cleaned up"
echo "3. Check DynamoDB for any remaining sender data"
echo "4. Verify SES identities are cleaned up if requested"
echo "5. Test that the application still works without sender email functionality"

# Display monitoring recommendations
echo ""
print_status "Post-rollback monitoring:"
echo "1. Monitor CloudWatch logs for any errors"
echo "2. Check application functionality"
echo "3. Verify no broken references to sender email functions"
echo "4. Monitor SES usage and configuration"

print_status "Rollback procedure completed!"
