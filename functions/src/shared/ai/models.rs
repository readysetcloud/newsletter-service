use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct GenerateInsightsEvent {
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "issueId")]
    pub issue_id: String,
    #[serde(rename = "subjectLine")]
    pub subject_line: Option<String>,
    #[serde(rename = "insightData")]
    pub insight_data: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct GenerateInsightsResponse {
    pub insights: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct GenerateSocialPostEvent {
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "issueId")]
    pub issue_id: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct GenerateSocialPostResponse {
    pub copy: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoricalAnalytics {
    #[serde(rename = "deliveredDate")]
    pub delivered_date: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}


