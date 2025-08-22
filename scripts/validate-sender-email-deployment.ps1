# PowerShell validation script for sender email setup deployment
# This script validates that the sender email setup feature is properly deployed and functional

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

function Write-Warni
ram([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Test {
    param([string]$Message)
    Write-Host "[TEST] $Message" -ForegroundColor Blue
}

$StackName = "newsletter-service"
$TestsPassed = 0
$TestsFailed = 0
$TotalTests = 0

# Function to run test and track results
function Run-Test {
    param(
        [string]$TestName,
        [scriptblock]$TestCommand
    )

    Write-Test "Testing: $TestName"
    $script:TotalTests++

    try {
        $result = & $TestCommand
        if ($result) {
            Write-Host "  ✓ PASSED" -ForegroundColor Green
            $script:TestsPassed++
            return $true
        } else {
            Write-Host "  ✗ FAILED" -ForegroundColor Red
            $script:TestsFailed++
            return $false
        }
    } catch {
        Write-Host "  ✗ FAILED" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
        $script:TestsFailed++
        return $false
    }
}

Write-Status "Starting validation for sender email setup in $Environment environment"

Write-Status "Validating AWS infrastructure..."

# Test 1: Check if stack exists
Run-Test "CloudFormation stack exists" {
    try {
        aws cloudformation describe-stacks --stack-name $StackName | Out-Null
        return $true
    } catch {
        return $false
    }
}

# Test 2: Check Lambda functions exist
$SenderFunctions = @(
    "GetSendersFunction",
    "CreateSenderFunction",
    "UpdateSenderFunction",
    "DeleteSenderFunction",
    "VerifyDomainFunction",
    "GetDomainVerificationFunction",
    "HandleSESEventFunction"
)

foreach ($func in $SenderFunctions) {
    Run-Test "Lambda function $func exists" {
        try {
            aws lambda get-function --function-name "$StackName-$func" | Out-Null
            return $true
        } catch {
            return $false
        }
    }
}

# Test 3: Check API Gateway endpoints
$ApiId = ""
try {
    $ApiId = aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs[?OutputKey==`DashboardApi`].OutputValue' --output text
} catch {
    Write-Warning "Could not retrieve API Gateway ID from stack outputs"
}

if ($ApiId -and $ApiId -ne "None") {
    Run-Test "API Gateway exists" {
        try {
            aws apigateway get-rest-api --rest-api-id $ApiId | Out-Null
            return $true
        } catch {
            return $false
        }
    }

    Run-Test "API Gateway /senders resource exists" {
        try {
            $resources = aws apigateway get-resources --rest-api-id $ApiId --query 'items[?pathPart==`senders`]' --output text
            return $resources -and $resources.Contains("senders")
        } catch {
            return $false
        }
    }
}

# Test 4: Check DynamoDB table
$TableName = ""
try {
    $TableName = aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs[?OutputKey==`NewsletterTable`].OutputValue' --output text
} catch {
    Write-Warning "Could not retrieve DynamoDB table name from stack outputs"
}

if ($TableName -and $TableName -ne "None") {
    Run-Test "DynamoDB table exists" {
        try {
            aws dynamodb describe-table --table-name $TableName | Out-Null
            return $true
        } catch {
            return $false
        }
    }

    Run-Test "DynamoDB GSI1 index exists" {
        try {
            $gsi = aws dynamodb describe-table --table-name $TableName --query 'Table.GlobalSecondaryIndexes[?IndexName==`GSI1`]' --output text
            return $gsi -and $gsi.Contains("GSI1")
        } catch {
            return $false
        }
    }
}

# Test 5: Check SES Configuration Set
$ConfigSetName = ""
try {
    $ConfigSetName = aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs[?OutputKey==`ConfigurationSet`].OutputValue' --output text
} catch {
    Write-Warning "Could not retrieve SES Configuration Set name from stack outputs"
}

if ($ConfigSetName -and $ConfigSetName -ne "None") {
    Run-Test "SES Configuration Set exists" {
        try {
            aws ses get-configuration-set --configuration-set-name $ConfigSetName | Out-Null
            return $true
        } catch {
            return $false
        }
    }

    Run-Test "SES Configuration Set has EventBridge destination" {
        try {
            $destinations = aws ses get-configuration-set-event-destinations --configuration-set-name $ConfigSetName --query 'EventDestinations[?Enabled==`true`]' --output text
            return $destinations -and $destinations.Contains("EventBridge")
        } catch {
            return $false
        }
    }
}

# Test 6: Check EventBridge rules
Run-Test "EventBridge rule for SES events exists" {
    try {
        $rules = aws events list-rules --name-prefix $StackName --query 'Rules[?contains(Name, `HandleSESEvent`)]' --output text
        return $rules -and $rules.Contains("HandleSESEvent")
    } catch {
        return $false
    }
}

# Test 7: Check IAM roles and permissions
foreach ($func in $SenderFunctions) {
    $RoleName = "$StackName-${func}Role-"
    Run-Test "IAM role for $func exists" {
        try {
            $roles = aws iam list-roles --query "Roles[?contains(RoleName, ``$RoleName``)]" --output text
            return $roles -and $roles.Contains($RoleName.Substring(0, $RoleName.Length - 1))
        } catch {
            return $false
        }
    }
}

Write-Status "Validating functional capabilities..."

# Test 8: Check Lambda function environment variables
foreach ($func in $SenderFunctions) {
    Run-Test "$func has required environment variables" {
        try {
            $tableName = aws lambda get-function-configuration --function-name "$StackName-$func" --query 'Environment.Variables.TABLE_NAME' --output text
            return $tableName -and $tableName -ne "None" -and $tableName -ne ""
        } catch {
            return $false
        }
    }
}

# Test 9: Test Lambda function invocation (basic)
Write-Test "Testing Lambda function invocation (GetSendersFunction)"
$TotalTests++

$TestEvent = @{
    requestContext = @{
        authorizer = @{
            tenantId = "test-tenant"
            userId = "test-user"
            tier = "free-tier"
        }
    }
    httpMethod = "GET"
    path = "/senders"
} | ConvertTo-Json -Depth 3

$TempFile = [System.IO.Path]::GetTempFileName()

try {
    $InvokeResult = aws lambda invoke --function-name "$StackName-GetSendersFunction" --payload $TestEvent --output json $TempFile 2>&1

    if ($InvokeResult -match '"StatusCode": 200') {
        Write-Host "  ✓ PASSED" -ForegroundColor Green
        $TestsPassed++

        if (Test-Path $TempFile) {
            $ResponseContent = Get-Content $TempFile -Raw
            if ($ResponseContent -match '"statusCode"') {
                Write-Host "  Response received successfully"
            }
        }
    } else {
        Write-Host "  ✗ FAILED" -ForegroundColor Red
        Write-Host "  Error: $InvokeResult" -ForegroundColor Red
        $TestsFailed++
    }
} catch {
    Write-Host "  ✗ FAILED" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    $TestsFailed++
} finally {
    if (Test-Path $TempFile) {
        Remove-Item $TempFile -Force
    }
}

# Test 10: Check CloudWatch Log Groups
foreach ($func in $SenderFunctions) {
    $LogGroup = "/aws/lambda/$StackName-$func"
    Run-Test "CloudWatch log group for $func exists" {
        try {
            $logGroups = aws logs describe-log-groups --log-group-name-prefix $LogGroup --query "logGroups[?logGroupName==``$LogGroup``]" --output text
            return $logGroups -and $logGroups.Contains($LogGroup)
        } catch {
            return $false
        }
    }
}

Write-Status "Validating monitoring and alerting..."

# Test 11: Check X-Ray tracing
foreach ($func in $SenderFunctions) {
    Run-Test "$func has X-Ray tracing enabled" {
        try {
            $tracingMode = aws lambda get-function-configuration --function-name "$StackName-$func" --query 'TracingConfig.Mode' --output text
            return $tracingMode -eq "Active"
        } catch {
            return $false
        }
    }
}

# Test 12: Validate network connectivity
if ($Environment -ne "sandbox") {
    $ApiUrl = ""
    try {
        $ApiUrl = aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs[?OutputKey==`NewsletterApiUrl`].OutputValue' --output text
    } catch {
        Write-Warning "Could not retrieve API URL from stack outputs"
    }

    if ($ApiUrl -and $ApiUrl -ne "None") {
        Write-Test "Testing API connectivity"
        $TotalTests++

        try {
            $response = Invoke-WebRequest -Uri "$ApiUrl/health" -Method GET -TimeoutSec 10 -ErrorAction SilentlyContinue
            $httpStatus = $response.StatusCode
        } catch {
            $httpStatus = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { 0 }
        }

        if ($httpStatus -in @(200, 404, 401, 403)) {
            Write-Host "  ✓ PASSED (HTTP $httpStatus)" -ForegroundColor Green
            $TestsPassed++
        } else {
            Write-Host "  ✗ FAILED (HTTP $httpStatus)" -ForegroundColor Red
            $TestsFailed++
        }
    }
}

# Summary
Write-Host ""
Write-Status "Validation Summary"
Write-Host "=================="
Write-Host "Total Tests: $TotalTests"
Write-Host "Passed: $TestsPassed" -ForegroundColor Green
Write-Host "Failed: $TestsFailed" -ForegroundColor Red

if ($TestsFailed -eq 0) {
    Write-Host ""
    Write-Status "🎉 All tests passed! Sender email setup is properly deployed and functional."

    Write-Host ""
    Write-Status "Next steps:"
    Write-Host "1. Run frontend integration tests"
    Write-Host "2. Test end-to-end sender email workflows"
    Write-Host "3. Monitor CloudWatch logs for any issues"
    Write-Host "4. Set up monitoring dashboards and alerts"

    exit 0
} else {
    Write-Host ""
    Write-Error "❌ Some tests failed. Please review the errors above and fix the issues."

    Write-Host ""
    Write-Status "Troubleshooting tips:"
    Write-Host "1. Check CloudFormation stack events for deployment errors"
    Write-Host "2. Review Lambda function logs in CloudWatch"
    Write-Host "3. Verify IAM permissions for all resources"
    Write-Host "4. Check SES service limits and configuration"
    Write-Host "5. Validate EventBridge rule patterns and targets"

    exit 1
}
