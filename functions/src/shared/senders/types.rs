use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SenderRecord {
    pub pk: String,
    pub sk: String,
    #[serde(rename = "GSI1PK")]
    pub gsi1pk: String,
    #[serde(rename = "GSI1SK")]
    pub gsi1sk: String,
    #[serde(rename = "senderId")]
    pub sender_id: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "verificationType")]
    pub verification_type: VerificationType,
    #[serde(rename = "verificationStatus")]
    pub verification_status: VerificationStatus,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sesIdentityArn")]
    pub ses_identity_arn: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "verifiedAt")]
    pub verified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "failureReason")]
    pub failure_reason: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "lastVerificationSent"
    )]
    pub last_verification_sent: Option<String>,
    #[serde(default, rename = "emailsSent")]
    pub emails_sent: i64,
    #[serde(skip_serializing_if = "Option::is_none", rename = "lastSentAt")]
    pub last_sent_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum VerificationType {
    Mailbox,
    Domain,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    Pending,
    Verified,
    Failed,
    VerificationTimedOut,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DomainVerificationRecord {
    pub pk: String,
    pub sk: String,
    pub domain: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "verificationStatus")]
    pub verification_status: VerificationStatus,
    #[serde(rename = "dnsRecords")]
    pub dns_records: Vec<DnsRecord>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sesIdentityArn")]
    pub ses_identity_arn: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "verifiedAt")]
    pub verified_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DnsRecord {
    pub name: String,
    #[serde(rename = "type")]
    pub record_type: String,
    pub value: String,
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierLimits {
    pub tier: String,
    #[serde(rename = "maxSenders")]
    pub max_senders: usize,
    #[serde(rename = "currentCount")]
    pub current_count: usize,
    #[serde(rename = "canUseDNS")]
    pub can_use_dns: bool,
    #[serde(rename = "canUseMailbox")]
    pub can_use_mailbox: bool,
}

pub const TIER_CONFIG: &[(&str, usize, bool, bool)] = &[
    ("free-tier", 1, false, true),
    ("creator-tier", 2, true, true),
    ("pro-tier", 5, true, true),
];

pub fn get_tier_limits(tier: &str, current_count: usize) -> TierLimits {
    let (_, max_senders, can_use_dns, can_use_mailbox) = TIER_CONFIG
        .iter()
        .find(|(t, _, _, _)| *t == tier)
        .unwrap_or(&("free-tier", 1, false, true));

    TierLimits {
        tier: tier.to_string(),
        max_senders: *max_senders,
        current_count,
        can_use_dns: *can_use_dns,
        can_use_mailbox: *can_use_mailbox,
    }
}

pub struct KeyPatterns;

impl KeyPatterns {
    pub fn sender(sender_id: &str) -> String {
        format!("sender#{}", sender_id)
    }

    pub fn domain(domain: &str) -> String {
        format!("domain#{}", domain)
    }

    pub fn sender_gsi1pk(tenant_id: &str) -> String {
        format!("sender#{}", tenant_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_pattern_sender() {
        let pattern = KeyPatterns::sender("abc-123");
        assert_eq!(pattern, "sender#abc-123");
    }

    #[test]
    fn test_key_pattern_domain() {
        let pattern = KeyPatterns::domain("example.com");
        assert_eq!(pattern, "domain#example.com");
    }

    #[test]
    fn test_key_pattern_sender_gsi1pk() {
        let pattern = KeyPatterns::sender_gsi1pk("tenant-456");
        assert_eq!(pattern, "sender#tenant-456");
    }

    #[test]
    fn test_tier_limits_free_tier() {
        let limits = get_tier_limits("free-tier", 0);
        assert_eq!(limits.tier, "free-tier");
        assert_eq!(limits.max_senders, 1);
        assert!(!limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_creator_tier() {
        let limits = get_tier_limits("creator-tier", 1);
        assert_eq!(limits.tier, "creator-tier");
        assert_eq!(limits.max_senders, 2);
        assert!(limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_pro_tier() {
        let limits = get_tier_limits("pro-tier", 3);
        assert_eq!(limits.tier, "pro-tier");
        assert_eq!(limits.max_senders, 5);
        assert!(limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_tier_limits_unknown_defaults_to_free() {
        let limits = get_tier_limits("unknown-tier", 0);
        assert_eq!(limits.tier, "unknown-tier");
        assert_eq!(limits.max_senders, 1);
        assert!(!limits.can_use_dns);
        assert!(limits.can_use_mailbox);
    }

    #[test]
    fn test_key_pattern_sender_with_uuid() {
        let uuid = "550e8400-e29b-41d4-a716-446655440000";
        let pattern = KeyPatterns::sender(uuid);
        assert_eq!(pattern, format!("sender#{}", uuid));
        assert!(pattern.starts_with("sender#"));
    }

    #[test]
    fn test_key_pattern_domain_with_subdomain() {
        let domain = "mail.example.com";
        let pattern = KeyPatterns::domain(domain);
        assert_eq!(pattern, "domain#mail.example.com");
        assert!(pattern.starts_with("domain#"));
    }

    #[test]
    fn test_key_pattern_sender_gsi1pk_format() {
        let tenant_id = "tenant-123-abc";
        let pattern = KeyPatterns::sender_gsi1pk(tenant_id);
        assert_eq!(pattern, "sender#tenant-123-abc");
        assert!(pattern.starts_with("sender#"));
        assert!(pattern.contains(tenant_id));
    }

    #[test]
    fn test_key_pattern_sender_empty_string() {
        let pattern = KeyPatterns::sender("");
        assert_eq!(pattern, "sender#");
    }

    #[test]
    fn test_key_pattern_domain_empty_string() {
        let pattern = KeyPatterns::domain("");
        assert_eq!(pattern, "domain#");
    }

    #[test]
    fn test_key_pattern_sender_with_special_chars() {
        let sender_id = "sender-123_abc.def";
        let pattern = KeyPatterns::sender(sender_id);
        assert_eq!(pattern, "sender#sender-123_abc.def");
    }
}
