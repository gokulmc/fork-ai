#!/usr/bin/env bash
# Full one-shot setup:
#   1. Verify forkai.in in SES + push DKIM records to Route 53
#   2. Deploy the CustomMessage Lambda
#   3. Wire Lambda trigger to Cognito
#   4. Switch Cognito email sender to SES (noreply@forkai.in)
#
# Run from anywhere in the repo:
#   bash infra/lambda/cognito-custom-email/setup.sh
#
# Prerequisites: aws CLI, jq

set -euo pipefail

REGION="ap-south-1"
DOMAIN="forkai.in"
FROM_EMAIL="noreply@forkai.in"
FROM_DISPLAY="fork.ai <${FROM_EMAIL}>"
FUNCTION_NAME="forkai-cognito-custom-email"
ROLE_NAME="forkai-cognito-custom-email-role"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# -- Read User Pool ID from .env.local ----------------------------------------

ENV_FILE="$SCRIPT_DIR/../../../apps/web/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Cannot read COGNITO_USER_POOL_ID."
  exit 1
fi
POOL_ID=$(grep '^COGNITO_USER_POOL_ID=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"' | tr -d "'" | tr -d ' ')
if [[ -z "$POOL_ID" ]]; then
  echo "ERROR: COGNITO_USER_POOL_ID not set in $ENV_FILE"
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "==========================================================="
echo "  fork.ai email setup"
echo "  Account : ${ACCOUNT_ID}"
echo "  Region  : ${REGION}"
echo "  Pool    : ${POOL_ID}"
echo "  Domain  : ${DOMAIN}"
echo "  From    : ${FROM_DISPLAY}"
echo "==========================================================="
echo ""

# =============================================================================
# 1. SES -- verify forkai.in + push DKIM records to Route 53
# =============================================================================

echo "-- 1/4  SES domain verification ------------------------------------"

IDENTITY_STATUS=$(aws sesv2 get-email-identity \
  --email-identity "${DOMAIN}" \
  --region "${REGION}" \
  --query "VerifiedForSendingStatus" \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [[ "$IDENTITY_STATUS" == "NOT_FOUND" ]]; then
  echo "-> Creating SES identity for ${DOMAIN}..."
  aws sesv2 create-email-identity \
    --email-identity "${DOMAIN}" \
    --dkim-signing-attributes NextSigningKeyLength=RSA_2048_BIT \
    --region "${REGION}" > /dev/null
  echo "   OK: SES identity created."
else
  echo "-> SES identity already exists (verified: ${IDENTITY_STATUS})."
fi

echo "-> Fetching DKIM tokens..."
DKIM_TOKENS=$(aws sesv2 get-email-identity \
  --email-identity "${DOMAIN}" \
  --region "${REGION}" \
  --query "DkimAttributes.Tokens" \
  --output json)

echo "-> Looking up Route 53 hosted zone for ${DOMAIN}..."
ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name "${DOMAIN}." \
  --max-items 1 \
  --query "HostedZones[0].Id" \
  --output text | sed 's|/hostedzone/||')

if [[ -z "$ZONE_ID" || "$ZONE_ID" == "None" ]]; then
  echo "ERROR: No Route 53 hosted zone found for ${DOMAIN}"
  exit 1
fi
echo "-> Hosted zone: ${ZONE_ID}"

# Build the Route 53 change batch (3 DKIM CNAMEs) using jq
CHANGE_BATCH=$(echo "$DKIM_TOKENS" | jq -c --arg domain "${DOMAIN}" '{
  Changes: map({
    Action: "UPSERT",
    ResourceRecordSet: {
      Name: ("\(.)._domainkey.\($domain)"),
      Type: "CNAME",
      TTL: 1800,
      ResourceRecords: [{ Value: ("\(.).dkim.amazonses.com") }]
    }
  })
}')

echo "-> Upserting 3 DKIM CNAME records in Route 53..."
aws route53 change-resource-record-sets \
  --hosted-zone-id "${ZONE_ID}" \
  --change-batch "$CHANGE_BATCH" \
  --query "ChangeInfo.Status" \
  --output text

echo "   OK: DNS records submitted. DKIM verifies within ~72h (usually minutes)."
echo "   NOTE: If ${DOMAIN} already has an SPF TXT record, add"
echo "         'include:amazonses.com' to it manually."
echo ""

# =============================================================================
# 2. Lambda -- create IAM role + deploy function
# =============================================================================

echo "-- 2/4  Lambda deploy ----------------------------------------------"

ROLE_ARN=$(aws iam get-role \
  --role-name "${ROLE_NAME}" \
  --query Role.Arn \
  --output text 2>/dev/null || echo "")

if [[ -z "$ROLE_ARN" ]]; then
  echo "-> Creating IAM role ${ROLE_NAME}..."
  TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  ROLE_ARN=$(aws iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document "$TRUST" \
    --query Role.Arn \
    --output text)
  aws iam attach-role-policy \
    --role-name "${ROLE_NAME}" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "   Waiting 12s for role to propagate..."
  sleep 12
else
  echo "-> IAM role already exists."
fi

echo "-> Packaging Lambda..."
cd "$SCRIPT_DIR"
zip -qj function.zip index.js

EXISTING_FN=$(aws lambda get-function \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --query "Configuration.FunctionArn" \
  --output text 2>/dev/null || echo "")

if [[ -z "$EXISTING_FN" ]]; then
  echo "-> Creating Lambda function..."
  aws lambda create-function \
    --function-name "${FUNCTION_NAME}" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --region "${REGION}" \
    --timeout 5 \
    --memory-size 128 \
    --description "Cognito CustomMessage trigger - branded HTML OTP emails for forkai.in" \
    --query "FunctionArn" \
    --output text
else
  echo "-> Updating existing Lambda function..."
  aws lambda update-function-code \
    --function-name "${FUNCTION_NAME}" \
    --zip-file fileb://function.zip \
    --region "${REGION}" \
    --query "FunctionArn" \
    --output text
fi

rm -f function.zip

LAMBDA_ARN=$(aws lambda get-function \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --query "Configuration.FunctionArn" \
  --output text)
echo "   OK: Lambda ready: ${LAMBDA_ARN}"

aws lambda add-permission \
  --function-name "${FUNCTION_NAME}" \
  --statement-id "cognito-custommessage-invoke" \
  --action "lambda:InvokeFunction" \
  --principal "cognito-idp.amazonaws.com" \
  --source-arn "arn:aws:cognito-idp:${REGION}:${ACCOUNT_ID}:userpool/${POOL_ID}" \
  --region "${REGION}" \
  --output text 2>/dev/null || echo "   (invoke permission already exists)"
echo ""

# =============================================================================
# 3. Cognito -- attach CustomMessage Lambda trigger (merge, don't clobber)
# =============================================================================

echo "-- 3/3  Cognito: Lambda trigger + SES email config -----------------"

SES_ARN="arn:aws:ses:${REGION}:${ACCOUNT_ID}:identity/${DOMAIN}"

# Lambda trigger + email config in one call — update-user-pool resets any
# top-level struct not included in the request, so these must travel together.
COMBINED_INPUT=/tmp/fork-cognito-update-$$.json
printf '{
  "UserPoolId": "%s",
  "LambdaConfig": {"CustomMessage": "%s"},
  "EmailConfiguration": {
    "EmailSendingAccount": "DEVELOPER",
    "SourceArn": "%s",
    "From": "%s"
  }
}\n' "${POOL_ID}" "${LAMBDA_ARN}" "${SES_ARN}" "${FROM_DISPLAY}" > "${COMBINED_INPUT}"

echo "-> Setting CustomMessage trigger + SES email config on pool ${POOL_ID}..."
aws cognito-idp update-user-pool \
  --region "${REGION}" \
  --cli-input-json "file://${COMBINED_INPUT}"
rm -f "${COMBINED_INPUT}"
echo "   OK: Lambda trigger attached, Cognito will send from ${FROM_DISPLAY} via SES."
echo ""

# =============================================================================
# Done
# =============================================================================

echo "==========================================================="
echo "  Setup complete"
echo ""
echo "  SES domain  : ${DOMAIN} (DKIM propagating)"
echo "  From address: ${FROM_DISPLAY}"
echo "  Lambda      : ${FUNCTION_NAME}"
echo ""
echo "  WARNING: SES sandbox is active by default."
echo "  OTPs only reach verified addresses until you run:"
echo ""
echo "  aws sesv2 put-account-details \\"
echo "    --production-access-enabled \\"
echo "    --mail-type TRANSACTIONAL \\"
echo "    --website-url https://forkai.in \\"
echo "    --use-case-description 'OTP emails for forkai.in sign-up'"
echo "==========================================================="
