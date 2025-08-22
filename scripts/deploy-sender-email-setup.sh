#!/bin/bash

# Deployment script for sender email setup feature
# This script handles the deployment of infrastructure changes for the sender email setup feature

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
    print_error "Environment parameter is required. Usage: ./deploy-sender-email-setup.sh [sandbox|stage|production]"
    exit 1
fi

ENVIRONMENT=$1

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(sandbox|stage|production)$ ]]; then
    print_error "Invalid environment. Must be one of: sandbox, stage, production"
    exit 1
fi

print_status "Starting deployment for sender email setup feature to $ENVIRONMENT environment"

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

# Check if esbuild is installed
if ! command -v esbuild &> /dev/null; then
    print_warning "esbuild is not installed globally. Installing..."
    npm install -g esbuild
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials are not configured or invalid."
    exit 1
fi

print_status "Prerequisites check passed"

# Install dependencies
print_status "Installing dependencies..."
npm ci

# Run tests before deployment
print_status "Running tests..."
npm run test

# Run linting
print_status "Running linting..."
npm run lint

print_status "Pre-deployment checks passed"

# Build the application
print_status "Building application..."
sam build --parallel

# Deploy based on environment
print_status "Deploying to $ENVIRONMENT environment..."

case $ENVIRONMENT in
    "sandbox")
        sam deploy --config-env default --no-fail-on-empty-changeset
        ;;
    "stage")
        sam deploy \
            --stack-name newsletter-service \
            --resolve-s3 \
            --no-fail-on-empty-changeset \
            --capabilities CAPABILITY_IAM \
            --parameter-overrides \
                Environment=stage \
                EncryptionKey=${ENCRYPTION_KEY:-"default-stage-key"} \
                MomentoCacheName=${MOMENTO_CACHE_NAME:-"newsletter"} \
                MomentoApiKey=${MOMENTO_API_KEY}
        ;;
    "production")
        # Additional confirmation for production
        print_warning "You are about to deploy to PRODUCTION environment."
        read -p "Are you sure you want to continue? (yes/no): " confirm
        if [[ $confirm != "yes" ]]; then
            print_status "Deployment cancelled"
            exit 0
        fi

        sam deploy \
            --stack-name newsletter-service \
            --resolve-s3 \
            --no-fail-on-empty-changeset \
            --capabilities CAPABILITY_IAM \
            --parameter-overrides \
                Environment=production \
                EncryptionKey=${ENCRYPTION_KEY} \
                MomentoCacheName=${MOMENTO_CACHE_NAME:-"newsletter"} \
                MomentoApiKey=${MOMENTO_API_KEY} \
                RedirectCustomDomain=${REDIRECT_CUSTOM_DOMAIN:-"rdyset.click"}
        ;;
esac

# Verify deployment
print_status "Verifying deployment..."

# Get stack outputs
STACK_NAME="newsletter-service"
API_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`NewsletterApiUrl`].OutputValue' --output text)

if [ -n "$API_URL" ]; then
    print_status "Deployment successful!"
    print_status "API URL: $API_URL"

    # Test basic API connectivity
    print_status "Testing API connectivity..."
    if curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" | grep -q "200\|404"; then
        print_status "API is responding"
    else
        print_warning "API might not be fully ready yet. This is normal for new deployments."
    fi
else
    print_error "Could not retrieve API URL from stack outputs"
    exit 1
fi

print_status "Sender email setup feature deployment completed successfully!"

# Display next steps
echo ""
print_status "Next steps:"
echo "1. Verify sender email functions are working by testing the API endpoints"
echo "2. Check CloudWatch logs for any errors"
echo "3. Test the frontend integration"
echo "4. Monitor SES configuration set events"

# Display important URLs and resources
echo ""
print_status "Important resources:"
echo "- API Base URL: $API_URL"
echo "- CloudWatch Logs: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups"
echo "- SES Console: https://console.aws.amazon.com/ses/home?region=us-east-1"
echo "- DynamoDB Tables: https://console.aws.amazon.com/dynamodb/home?region=us-east-1#tables"
