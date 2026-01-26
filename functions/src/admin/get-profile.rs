use aws_sdk_cognitoidentityprovider::types::AttributeType;
use aws_sdk_dynamodb::types::AttributeValue;
use aws_smithy_types::DateTime;
use lambda_http::{run, service_fn, Body, Error, Request, RequestExt, Response};
use newsletter_lambdas::admin::{
    aws_clients, dynamodb_utils, format_error_response, format_response, get_user_context, AppError,
};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileResponse {
    user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    brand: BrandData,
    profile: ProfileData,
    preferences: PreferencesData,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_modified: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct BrandData {
    #[serde(skip_serializing_if = "Option::is_none")]
    brand_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    brand_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    website: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    industry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    brand_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    brand_logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_updated: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProfileData {
    #[serde(skip_serializing_if = "Option::is_none")]
    first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    links: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_updated: Option<String>,
}

#[derive(Serialize, Default)]
struct PreferencesData {
    #[serde(skip_serializing_if = "Option::is_none")]
    timezone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locale: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicProfileResponse {
    brand: BrandData,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    links: Option<Vec<String>>,
}

struct TenantRecord {
    name: Option<String>,
    brand_name: Option<String>,
    website: Option<String>,
    industry: Option<String>,
    brand_description: Option<String>,
    brand_logo: Option<String>,
    tags: Option<Vec<String>>,
    updated_at: String,
}

impl TenantRecord {
    fn from_dynamodb_item(item: HashMap<String, AttributeValue>) -> Result<Self, AppError> {
        Ok(Self {
            name: dynamodb_utils::get_optional_string_attr(&item, "name"),
            brand_name: dynamodb_utils::get_optional_string_attr(&item, "brandName"),
            website: dynamodb_utils::get_optional_string_attr(&item, "website"),
            industry: dynamodb_utils::get_optional_string_attr(&item, "industry"),
            brand_description: dynamodb_utils::get_optional_string_attr(&item, "brandDescription"),
            brand_logo: dynamodb_utils::get_optional_string_attr(&item, "brandLogo"),
            tags: dynamodb_utils::get_optional_string_list_attr(&item, "tags"),
            updated_at: dynamodb_utils::get_string_attr(&item, "updatedAt")?,
        })
    }
}

#[derive(Debug, Default)]
struct CognitoUserAttributes {
    sub: String,
    email: Option<String>,
    given_name: Option<String>,
    family_name: Option<String>,
    zoneinfo: Option<String>,
    locale: Option<String>,
    tenant_id: Option<String>,
    profile_links: Option<String>,
    profile_updated_at: Option<String>,
}

impl CognitoUserAttributes {
    fn from_cognito_attributes(attrs: Vec<AttributeType>) -> Self {
        let mut result = Self::default();

        for attr in attrs {
            if let Some(value) = attr.value {
                match attr.name.as_str() {
                    "sub" => result.sub = value,
                    "email" => result.email = Some(value),
                    "given_name" => result.given_name = Some(value),
                    "family_name" => result.family_name = Some(value),
                    "zoneinfo" => result.zoneinfo = Some(value),
                    "locale" => result.locale = Some(value),
                    "custom:tenant_id" => result.tenant_id = Some(value),
                    "custom:profile_links" => result.profile_links = Some(value),
                    "custom:profile_updated_at" => result.profile_updated_at = Some(value),
                    _ => {}
                }
            }
        }

        result
    }

    fn parse_profile_links(&self) -> Option<Vec<String>> {
        self.profile_links
            .as_ref()
            .and_then(|links_str| serde_json::from_str(links_str).ok())
    }
}

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    let user_context = get_user_context(&event)?;
    let user_id = user_context.user_id.clone();
    let current_user_email = user_context.email.clone();
    let tenant_id = user_context.tenant_id.clone();

    let path_params = event.path_parameters();
    let requested_user_id = path_params.first("userId");
    let is_own_profile = requested_user_id.is_none();

    let target_email = if is_own_profile {
        current_user_email
    } else {
        match find_user_email_by_sub(requested_user_id.unwrap()).await {
            Some(email) => email,
            None => {
                return Ok(format_response(
                    404,
                    serde_json::json!({"message": "User not found"}),
                )?)
            }
        }
    };

    let cognito_client = aws_clients::get_cognito_client().await;
    let user_pool_id = std::env::var("USER_POOL_ID")
        .map_err(|_| AppError::InternalError("USER_POOL_ID not set".to_string()))?;

    let user_result = cognito_client
        .admin_get_user()
        .user_pool_id(&user_pool_id)
        .username(&target_email)
        .send()
        .await?;

    let attributes =
        CognitoUserAttributes::from_cognito_attributes(user_result.user_attributes().to_vec());

    let profile = if is_own_profile {
        serde_json::to_value(
            build_own_profile(
                &user_id,
                &attributes,
                user_result.user_last_modified_date(),
                &tenant_id,
            )
            .await?,
        )?
    } else {
        serde_json::to_value(build_public_profile(&attributes).await?)?
    };

    Ok(format_response(200, profile)?)
}

async fn find_user_email_by_sub(user_id: &str) -> Option<String> {
    let cognito_client = aws_clients::get_cognito_client().await;
    let user_pool_id = std::env::var("USER_POOL_ID").ok()?;

    let list_result = cognito_client
        .list_users()
        .user_pool_id(&user_pool_id)
        .filter(format!("sub = \"{}\"", user_id))
        .limit(1)
        .send()
        .await
        .ok()?;

    list_result.users().first().and_then(|user| {
        user.attributes()
            .iter()
            .find(|attr| attr.name == "email")
            .and_then(|attr| attr.value.clone())
    })
}

async fn build_own_profile(
    user_id: &str,
    attributes: &CognitoUserAttributes,
    last_modified: Option<&DateTime>,
    tenant_id: &Option<String>,
) -> Result<ProfileResponse, AppError> {
    let brand_data = if let Some(tid) = tenant_id {
        fetch_brand_data(tid).await
    } else {
        BrandData::default()
    };

    let last_modified_str = last_modified.map(|dt: &DateTime| dt.to_string());

    Ok(ProfileResponse {
        user_id: user_id.to_string(),
        email: attributes.email.clone(),
        brand: brand_data,
        profile: ProfileData {
            first_name: attributes.given_name.clone(),
            last_name: attributes.family_name.clone(),
            links: attributes.parse_profile_links(),
            last_updated: attributes.profile_updated_at.clone(),
        },
        preferences: PreferencesData {
            timezone: attributes.zoneinfo.clone(),
            locale: attributes.locale.clone(),
        },
        last_modified: last_modified_str,
    })
}

async fn build_public_profile(
    attributes: &CognitoUserAttributes,
) -> Result<PublicProfileResponse, AppError> {
    let brand_data = if let Some(tid) = &attributes.tenant_id {
        fetch_brand_data(tid).await
    } else {
        BrandData::default()
    };

    Ok(PublicProfileResponse {
        brand: brand_data,
        first_name: attributes.given_name.clone(),
        last_name: attributes.family_name.clone(),
        links: attributes.parse_profile_links(),
    })
}

async fn fetch_brand_data(tenant_id: &str) -> BrandData {
    let ddb_client = aws_clients::get_dynamodb_client().await;
    let table_name = match std::env::var("TABLE_NAME") {
        Ok(name) => name,
        Err(_) => {
            return BrandData {
                brand_id: Some(tenant_id.to_string()),
                ..Default::default()
            }
        }
    };

    let result = ddb_client
        .get_item()
        .table_name(&table_name)
        .key("pk", AttributeValue::S(tenant_id.to_string()))
        .key("sk", AttributeValue::S("tenant".to_string()))
        .send()
        .await;

    match result {
        Ok(output) => {
            if let Some(item) = output.item() {
                match TenantRecord::from_dynamodb_item(item.clone()) {
                    Ok(tenant) => BrandData {
                        brand_id: Some(tenant_id.to_string()),
                        brand_name: tenant.name.or(tenant.brand_name),
                        website: tenant.website,
                        industry: tenant.industry,
                        brand_description: tenant.brand_description,
                        brand_logo: tenant.brand_logo,
                        tags: tenant.tags,
                        last_updated: Some(tenant.updated_at),
                    },
                    Err(_) => BrandData {
                        brand_id: Some(tenant_id.to_string()),
                        ..Default::default()
                    },
                }
            } else {
                BrandData {
                    brand_id: Some(tenant_id.to_string()),
                    ..Default::default()
                }
            }
        }
        Err(_) => BrandData {
            brand_id: Some(tenant_id.to_string()),
            ..Default::default()
        },
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(|event: Request| async move {
        match function_handler(event).await {
            Ok(response) => Ok::<Response<Body>, std::convert::Infallible>(response),
            Err(e) => {
                tracing::error!(error = %e, "Function execution failed");

                if let Some(app_err) = e.downcast_ref::<AppError>() {
                    Ok(format_error_response(app_err))
                } else {
                    Ok(format_error_response(&AppError::InternalError(
                        e.to_string(),
                    )))
                }
            }
        }
    }))
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // Feature: rust-lambda-migration, Property 1: Functional Equivalence for Profile Operations
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn test_cognito_attributes_parsing(
            sub in "[a-z0-9]{8,36}",
            email in "[a-z0-9]+@[a-z0-9]+\\.[a-z]{2,5}",
            given_name in "[A-Z][a-z]{2,10}",
            family_name in "[A-Z][a-z]{2,15}",
            has_tenant in prop::bool::ANY,
            tenant_id in "[a-z0-9]{8,20}"
        ) {
            let mut attrs = vec![
                AttributeType::builder()
                    .name("sub")
                    .value(&sub)
                    .build()
                    .unwrap(),
                AttributeType::builder()
                    .name("email")
                    .value(&email)
                    .build()
                    .unwrap(),
                AttributeType::builder()
                    .name("given_name")
                    .value(&given_name)
                    .build()
                    .unwrap(),
                AttributeType::builder()
                    .name("family_name")
                    .value(&family_name)
                    .build()
                    .unwrap(),
            ];

            if has_tenant {
                attrs.push(
                    AttributeType::builder()
                        .name("custom:tenant_id")
                        .value(&tenant_id)
                        .build()
                        .unwrap()
                );
            }

            let parsed = CognitoUserAttributes::from_cognito_attributes(attrs);

            prop_assert_eq!(&parsed.sub, &sub, "sub should match");
            prop_assert_eq!(parsed.email.as_deref(), Some(email.as_str()), "email should match");
            prop_assert_eq!(parsed.given_name.as_deref(), Some(given_name.as_str()), "given_name should match");
            prop_assert_eq!(parsed.family_name.as_deref(), Some(family_name.as_str()), "family_name should match");

            if has_tenant {
                prop_assert_eq!(parsed.tenant_id.as_deref(), Some(tenant_id.as_str()), "tenant_id should match when present");
            } else {
                prop_assert!(parsed.tenant_id.is_none(), "tenant_id should be None when not present");
            }
        }

        #[test]
        fn test_profile_links_json_parsing(
            links in prop::collection::vec("[a-z]+://[a-z]+\\.[a-z]{2,5}", 0..5)
        ) {
            let links_json = serde_json::to_string(&links).unwrap();

            let attrs = vec![
                AttributeType::builder()
                    .name("sub")
                    .value("test-user-id")
                    .build()
                    .unwrap(),
                AttributeType::builder()
                    .name("custom:profile_links")
                    .value(&links_json)
                    .build()
                    .unwrap(),
            ];

            let parsed = CognitoUserAttributes::from_cognito_attributes(attrs);
            let parsed_links = parsed.parse_profile_links();

            if links.is_empty() {
                prop_assert!(parsed_links.is_none() || parsed_links == Some(vec![]), "empty links should parse correctly");
            } else {
                prop_assert_eq!(parsed_links, Some(links.clone()), "links should round-trip through JSON");
            }
        }
    }

    #[test]
    fn test_missing_tenant_id_handling() {
        let attrs = vec![
            AttributeType::builder()
                .name("sub")
                .value("test-user-id")
                .build()
                .unwrap(),
            AttributeType::builder()
                .name("email")
                .value("test@example.com")
                .build()
                .unwrap(),
        ];

        let parsed = CognitoUserAttributes::from_cognito_attributes(attrs);
        assert!(
            parsed.tenant_id.is_none(),
            "tenant_id should be None when not provided"
        );
    }

    #[test]
    fn test_profile_links_invalid_json() {
        let attrs = vec![
            AttributeType::builder()
                .name("sub")
                .value("test-user-id")
                .build()
                .unwrap(),
            AttributeType::builder()
                .name("custom:profile_links")
                .value("invalid json")
                .build()
                .unwrap(),
        ];

        let parsed = CognitoUserAttributes::from_cognito_attributes(attrs);
        let parsed_links = parsed.parse_profile_links();
        assert!(parsed_links.is_none(), "invalid JSON should return None");
    }

    #[test]
    fn test_profile_links_empty_string() {
        let attrs = vec![
            AttributeType::builder()
                .name("sub")
                .value("test-user-id")
                .build()
                .unwrap(),
            AttributeType::builder()
                .name("custom:profile_links")
                .value("")
                .build()
                .unwrap(),
        ];

        let parsed = CognitoUserAttributes::from_cognito_attributes(attrs);
        let parsed_links = parsed.parse_profile_links();
        assert!(parsed_links.is_none(), "empty string should return None");
    }
}
