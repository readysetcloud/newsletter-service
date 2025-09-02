/**
 * @fileoverview Type definitions for sender email management
 */

/**
 * @typedef {Object} SenderEmailRecord
 * @property {string} pk - Partition key (tenantId)
 * @property {string} sk - Sort key (sender#{senderId})
 * @property {string} GSI1PK - GSI1 partition key (sender#{tenantId})
 * @property {string} GSI1SK - GSI1 sort key (email)
 * @property {string} senderId - UUID for the sender
 * @property {string} tenantId - Tenant identifier
 * @property {string} email - Sender email address
 * @property {string} [name] - Display name for sender
 * @property {'mailbox'|'domain'} verificationType - Type of verification
 * @property {'pending'|'verified'|'failed'|'verification_timed_out'} verificationStatus - Current status
 * @property {boolean} isDefault - Whether this is the default sender
 * @property {string} [domain] - Domain for domain verification
 * @property {string} [sesIdentityArn] - SES identity ARN
 * @property {string} verificationInitiatedAt - ISO timestamp when verification started
 * @property {string} verificationExpiresAt - ISO timestamp when verification expires (24h)
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {string} [verifiedAt] - ISO timestamp when verified
 * @property {string} [failureReason] - Reason for verification failure
 * @property {number} [emailsSent] - Total number of emails sent from this sender
 * @property {string} [lastSentAt] - ISO timestamp of last email sent
 */

/**
 * @typedef {Object} DomainVerificationRecord
 * @property {string} pk - Partition key (tenantId)
 * @property {string} sk - Sort key (domain#{domain})
 * @property {string} domain - Domain name
 * @property {string} tenantId - Tenant identifier
 * @property {'pending'|'verified'|'failed'|'verification_timed_out'} verificationStatus - Current status
 * @property {DnsRecord[]} dnsRecords - DNS records to add
 * @property {string} [sesIdentityArn] - SES identity ARN
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {string} [verifiedAt] - ISO timestamp when verified
 */

/**
 * @typedef {Object} DnsRecord
 * @property {string} name - DNS record name
 * @property {string} type - DNS record type (TXT, CNAME, etc.)
 * @property {string} value - DNS record value
 * @property {string} description - User-friendly description
 */

/**
 * @typedef {Object} TierLimits
 * @property {'free-tier'|'creator-tier'|'pro-tier'} tier - User tier
 * @property {number} maxSenders - Maximum allowed senders
 * @property {number} currentCount - Current sender count
 * @property {boolean} canUseDNS - Whether DNS verification is allowed
 * @property {boolean} canUseMailbox - Whether mailbox verification is allowed
 */

/**
 * @typedef {Object} CreateSenderRequest
 * @property {string} email - Email address to verify
 * @property {string} [name] - Display name for sender
 * @property {'mailbox'|'domain'} verificationType - Type of verification
 */

/**
 * @typedef {Object} UpdateSenderRequest
 * @property {string} [name] - Display name for sender
 * @property {boolean} [isDefault] - Whether to set as default sender
 */

/**
 * @typedef {Object} VerifyDomainRequest
 * @property {string} domain - Domain to verify
 */

/**
 * @typedef {Object} AuthorizerContext
 * @property {string} tenantId - Tenant identifier from authorizer
 * @property {string} userId - User identifier from authorizer
 * @property {'free-tier'|'creator-tier'|'pro-tier'} tier - User tier from authorizer
 */

/**
 * @typedef {Object} ApiResponse
 * @property {boolean} success - Whether the operation was successful
 * @property {*} [data] - Response data
 * @property {string} [error] - Error message
 * @property {string} [message] - Success message
 */

/**
 * Tier configuration mapping
 */
export const TIER_LIMITS = {
  'free-tier': {
    maxSenders: 1,
    canUseDNS: false,
    canUseMailbox: true
  },
  'creator-tier': {
    maxSenders: 2,
    canUseDNS: true,
    canUseMailbox: true
  },
  'pro-tier': {
    maxSenders: 5,
    canUseDNS: true,
    canUseMailbox: true
  }
};

/**
 * DynamoDB key patterns
 */
export const KEY_PATTERNS = {
  SENDER: (senderId) => `sender#${senderId}`,
  DOMAIN: (domain) => `domain#${domain}`,
  SENDER_GSI1PK: (tenantId) => `sender#${tenantId}`
};
