#!/bin/bash

# Validation script for sender email setup deployment
# This script validates that the sender email setup feature is properly deployed and functional

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

# Check if environment is provided
if [ -z "$1" ]; then
    print_error "Environment parameter is required. Usage: ./validate-sender-email-deployment.sh [sandbox|stage|production]"
    exit 1
fi

ENVIRONMENT=$1
STACK_NAME="newsletter-service"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(sandbox|stage|production)$ ]]; then
    print_error "Invalid environment. Must be one of: sandbox, stage, production"
    exit 1
fi

print_status "Starting van for sender email setup in $ENVIRONMENT environment"

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TOTAL_TESTS=0

# Function to run test and track results
run_test() {
    local test_name="$1"
    local test_command="$2"

    print_test "Testing: $test_name"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    if eval "$test_command" &> /dev/null; then
        echo -e "  ${GREEN}✓ PASSED${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "  ${RED}✗ FAILED${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Function to run test with output
run_test_with_output() {
    local test_name="$1"
    local test_command="$2"

    print_test "Testing: $test_name"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    local output
    output=$(eval "$test_command" 2>&1)
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "  ${GREEN}✓ PASSED${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        if [ -n "$output" ]; then
            echo "  Output: $output"
        fi
        return 0
    else
        echo -e "  ${RED}✗ FAILED${NC}"
        echo "  Error: $output"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

print_status "Validating AWS infrastructure..."

# Test 1: Check if stack exists
run_test "CloudFormation stack exists" \
    "aws cloudformation describe-stacks --stack-name $STACK_NAME"

# Test 2: Check Lambda functions exist
SENDER_FUNCTIONS=(
    "GetSendersFunction"
    "CreateSenderFunction"
    "UpdateSenderFunction"
    "DeleteSenderFunction"
    "VerifyDomainFunction"
    "GetDomainVerificationFunction"
    "HandleSESEventFunction"
)

for func in "${SENDER_FUNCTIONS[@]}"; do
    run_test "Lambda function $func exists" \
        "aws lambda get-function --function-name $STACK_NAME-$func"
done

# Test 3: Check API Gateway endpoints
API_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`DashboardApi`].OutputValue' --output text 2>/dev/null || echo "")

if [ -n "$API_ID" ]; then
    run_test "API Gateway exists" \
        "aws apigateway get-rest-api --rest-api-id $API_ID"

    # Check specific resources
    run_test "API Gateway /senders resource exists" \
        "aws apigateway get-resources --rest-api-id $API_ID --query 'items[?pathPart==\`senders\`]' --output text | grep -q senders"
else
    print_warning "Could not retrieve API Gateway ID from stack outputs"
fi

# Test 4: Check DynamoDB table
TABLE_NAME=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`NewsletterTable`].OutputValue' --output text 2>/dev/null || echo "")

if [ -n "$TABLE_NAME" ]; then
    run_test "DynamoDB table exists" \
        "aws dynamodb describe-table --table-name $TABLE_NAME"

    run_test "DynamoDB GSI1 index exists" \
        "aws dynamodb describe-table --table-name $TABLE_NAME --query 'Table.GlobalSecondaryIndexes[?IndexName==\`GSI1\`]' --output text | grep -q GSI1"
else
    print_warning "Could not retrieve DynamoDB table name from stack outputs"
fi

# Test 5: Check SES Configuration Set
CONFIG_SET_NAME=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`ConfigurationSet`].OutputValue' --output text 2>/dev/null || echo "")

if [ -n "$CONFIG_SET_NAME" ]; then
    run_test "SES Configuration Set exists" \
        "aws ses get-configuration-set --configuration-set-name $CONFIG_SET_NAME"

    run_test "SES Configuration Set has EventBridge destination" \
        "aws ses get-configuration-set-event-destinations --configuration-set-name $CONFIG_SET_NAME --query 'EventDestinations[?Enabled==\`true\`]' --output text | grep -q EventBridge"
else
    print_warning "Could not retrieve SES Configuration Set name from stack outputs"
fi

# Test 6: Check EventBridge rules
run_test "EventBridge rule for SES events exists" \
    "aws events list-rules --name-prefix $STACK_NAME --query 'Rules[?contains(Name, \`HandleSESEvent\`)]' --output text | grep -q HandleSESEvent"

# Test 7: Check IAM roles and permissions
for func in "${SENDER_FUNCTIONS[@]}"; do
    ROLE_NAME="$STACK_NAME-${func}Role-"
    run_test "IAM role for $func exists" \
        "aws iam list-roles --query 'Roles[?contains(RoleName, \`$ROLE_NAME\`)]' --output text | grep -q $ROLE_NAME"
done

print_status "Validating functional capabilities..."

# Test 8: Check Lambda function environment variables
for func in "${SENDER_FUNCTIONS[@]}"; do
    run_test "$func has required environment variables" \
        "aws lambda get-function-configuration --function-name $STACK_NAME-$func --query 'Environment.Variables.TABLE_NAME' --output text | grep -q ."
done

# Test 9: Test Lambda function invocation (basic)
print_test "Testing Lambda function invocation (GetSendersFunction)"
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# Create a test event for GetSendersFunction
TEST_EVENT='{
  "requestContext": {
    "authorizer": {
      "tenantId": "test-tenant",
      "userId": "test-user",
      "tier": "free-tier"
    }
  },
  "httpMethod": "GET",
  "path": "/senders"
}'

INVOKE_RESULT=$(aws lambda invoke \
    --function-name "$STACK_NAME-GetSendersFunction" \
    --payload "$TEST_EVENT" \
    --output json \
    /tmp/lambda-response.json 2>&1)

if echo "$INVOKE_RESULT" | grep -q '"StatusCode": 200'; then
    echo -e "  ${GREEN}✓ PASSED${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))

    # Check response content
    if [ -f "/tmp/lambda-response.json" ]; then
        RESPONSE_CONTENT=$(cat /tmp/lambda-response.json)
        if echo "$RESPONSE_CONTENT" | grep -q '"statusCode"'; then
            echo "  Response received successfully"
        fi
    fi
else
    echo -e "  ${RED}✗ FAILED${NC}"
    echo "  Error: $INVOKE_RESULT"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Clean up test file
rm -f /tmp/lambda-response.json

# Test 10: Check CloudWatch Log Groups
for func in "${SENDER_FUNCTIONS[@]}"; do
    LOG_GROUP="/aws/lambda/$STACK_NAME-$func"
    run_test "CloudWatch log group for $func exists" \
        "aws logs describe-log-groups --log-group-name-prefix $LOG_GROUP --query 'logGroups[?logGroupName==\`$LOG_GROUP\`]' --output text | grep -q $LOG_GROUP"
done

print_status "Validating monitoring and alerting..."

# Test 11: Check X-Ray tracing
for func in "${SENDER_FUNCTIONS[@]}"; do
    run_test "$func has X-Ray tracing enabled" \
        "aws lambda get-function-configuration --function-name $STACK_NAME-$func --query 'TracingConfig.Mode' --output text | grep -q Active"
done

# Test 12: Validate network connectivity
if [ "$ENVIRONMENT" != "sandbox" ]; then
    API_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`NewsletterApiUrl`].OutputValue' --output text 2>/dev/null || echo "")

    if [ -n "$API_URL" ]; then
        print_test "Testing API connectivity"
        TOTAL_TESTS=$((TOTAL_TESTS + 1))

        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" --max-time 10 || echo "000")

        if [[ "$HTTP_STATUS" =~ ^(200|404|401|403)$ ]]; then
            echo -e "  ${GREEN}✓ PASSED${NC} (HTTP $HTTP_STATUS)"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "  ${RED}✗ FAILED${NC} (HTTP $HTTP_STATUS)"
            TESTS_FAILED=$((TESTS_FAILED + 1))
        fi
    fi
fi

# Summary
echo ""
print_status "Validation Summary"
echo "=================="
echo "Total Tests: $TOTAL_TESTS"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo ""
    print_status "🎉 All tests passed! Sender email setup is properly deployed and functional."

    echo ""
    print_status "Next steps:"
    echo "1. Run frontend integration tests"
    echo "2. Test end-to-end sender email workflows"
    echo "3. Monitor CloudWatch logs for any issues"
    echo "4. Set up monitoring dashboards and alerts"

    exit 0
else
    echo ""
    print_error "❌ Some tests failed. Please review the errors above and fix the issues."

    echo ""
    print_status "Troubleshooting tips:"
    echo "1. Check CloudFormation stack events for deployment errors"
    echo "2. Review Lambda function logs in CloudWatch"
    echo "3. Verify IAM permissions for all resources"
    echo "4. Check SES service limits and configuration"
    echo "5. Validate EventBridge rule patterns and targets"

    exit 1
fi
