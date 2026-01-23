use aws_sdk_dynamodb::types::AttributeValue;
use std::collections::HashMap;
use crate::error::AppError;

pub fn get_string_attr(item: &HashMap<String, AttributeValue>, key: &str) -> Result<String, AppError> {
    item.get(key)
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::InternalError(format!("Missing or invalid attribute: {}", key)))
}

pub fn get_optional_string_attr(item: &HashMap<String, AttributeValue>, key: &str) -> Option<String> {
    item.get(key)
        .and_then(|v| v.as_s().ok())
        .map(|s| s.to_string())
}

pub fn get_optional_string_list_attr(item: &HashMap<String, AttributeValue>, key: &str) -> Option<Vec<String>> {
    item.get(key)
        .and_then(|v| v.as_l().ok())
        .map(|list| {
            list.iter()
                .filter_map(|item| item.as_s().ok())
                .map(|s| s.to_string())
                .collect()
        })
}

pub fn get_optional_number_attr(item: &HashMap<String, AttributeValue>, key: &str) -> Option<i64> {
    item.get(key)
        .and_then(|v| v.as_n().ok())
        .and_then(|n| n.parse().ok())
}
