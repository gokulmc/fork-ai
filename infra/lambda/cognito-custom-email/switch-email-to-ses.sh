#!/usr/bin/env bash
# Switch the Cognito user pool's verification/OTP email from COGNITO_DEFAULT
# (Cognito's built-in mailer, 50/day cap, generic sender) to DEVELOPER mode,
# sending through the already-verified SES identity for forkai.in.
#
#   Dry run (default) — prints the exact JSON it WOULD send, applies nothing:
#     bash infra/lambda/cognito-custom-email/switch-email-to-ses.sh
#
#   Apply for real:
#     bash infra/lambda/cognito-custom-email/switch-email-to-ses.sh --apply
#
# Prerequisites: aws CLI v1, jq. SES domain forkai.in must already be verified
# (it is) and the CustomMessage Lambda already deployed (it is).
#
# WHY describe -> merge -> update (not a minimal call):
#   `aws cognito-idp update-user-pool` is a FULL REPLACE — any top-level field
#   you omit is reset to its default (password policy, account recovery, MFA,
#   verification templates, Lambda triggers, ...). So we read the current pool
#   and pass everything back, overriding only EmailConfiguration.

set -euo pipefail

REGION="ap-south-1"
DOMAIN="forkai.in"
FROM_EMAIL="verify@forkai.in"
FROM_DISPLAY="fork ai <${FROM_EMAIL}>"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../../../apps/web/.env.local"
POOL_ID=$(grep '^COGNITO_USER_POOL_ID=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"' | tr -d "'" | tr -d ' ')
[[ -z "$POOL_ID" ]] && { echo "ERROR: COGNITO_USER_POOL_ID not found in $ENV_FILE"; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SES_ARN="arn:aws:ses:${REGION}:${ACCOUNT_ID}:identity/${DOMAIN}"

echo "Pool      : ${POOL_ID}"
echo "SES ARN   : ${SES_ARN}"
echo "From      : ${FROM_DISPLAY}"
echo "Mode      : $([[ $APPLY -eq 1 ]] && echo APPLY || echo 'DRY RUN (no changes)')"
echo ""

# Read the current pool, then keep every update-user-pool-settable field and
# override only EmailConfiguration. Top-level nulls are stripped so we don't
# send null for fields the pool doesn't use (e.g. SmsConfiguration).
CURRENT=$(aws cognito-idp describe-user-pool \
  --user-pool-id "${POOL_ID}" --region "${REGION}" \
  --query UserPool --output json)

PAYLOAD=$(echo "$CURRENT" | jq \
  --arg pool "$POOL_ID" --arg arn "$SES_ARN" --arg from "$FROM_DISPLAY" '
  {
    UserPoolId: $pool,
    Policies: .Policies,
    DeletionProtection: .DeletionProtection,
    LambdaConfig: .LambdaConfig,
    AutoVerifiedAttributes: .AutoVerifiedAttributes,
    VerificationMessageTemplate: .VerificationMessageTemplate,
    SmsAuthenticationMessage: .SmsAuthenticationMessage,
    UserAttributeUpdateSettings: .UserAttributeUpdateSettings,
    MfaConfiguration: .MfaConfiguration,
    DeviceConfiguration: .DeviceConfiguration,
    SmsConfiguration: .SmsConfiguration,
    UserPoolTags: .UserPoolTags,
    AdminCreateUserConfig: .AdminCreateUserConfig,
    UserPoolAddOns: .UserPoolAddOns,
    AccountRecoverySetting: .AccountRecoverySetting,
    EmailConfiguration: {
      EmailSendingAccount: "DEVELOPER",
      SourceArn: $arn,
      From: $from
    }
  }
  | with_entries(select(.value != null))')

echo "----- update-user-pool payload (review this) -------------------------"
echo "$PAYLOAD" | jq .
echo "---------------------------------------------------------------------"
echo ""

if [[ $APPLY -ne 1 ]]; then
  echo "DRY RUN — nothing changed. Re-run with --apply to send the above."
  exit 0
fi

TMP=/tmp/fork-cognito-ses-$$.json
echo "$PAYLOAD" > "$TMP"
echo "-> Applying..."
aws cognito-idp update-user-pool --region "${REGION}" --cli-input-json "file://${TMP}"
rm -f "$TMP"

echo ""
echo "Verifying new EmailConfiguration:"
aws cognito-idp describe-user-pool --user-pool-id "${POOL_ID}" --region "${REGION}" \
  --query 'UserPool.EmailConfiguration' --output json
echo ""
echo "Done. Cognito now sends OTP/verification mail from ${FROM_DISPLAY} via SES."
