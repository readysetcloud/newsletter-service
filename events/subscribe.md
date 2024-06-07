# Event schemas and examples

## Add newsletter issue

### Publisher

* EventBridge Event via integration (like GitHub)

### Example

```json
{
  "detail-type": "Create Newsletter Issue",
  "source": "<Integration name>",
  "detail": {
    "source": "github",
    "github": {
      "branch": "adding-newsletter-issue",
      "fileName": "content/newsletter/issue-115"
    },
    "tenantId": "readysetcloud"
  }
}
```

## Start Stage Issue State Machine

### Event

```json
{
  "key": "ready-set-cloud#content/newsletter/issue-115",
  "content": "<all contents of the newsletter>",
  "fileName": "content/newsletter/issue-115",
  "tenant": {
    "id": "ready-set-cloud",
    "contactEmail": "allenheltondev@gmail.com"
  }
}
```

## Add tenant

### Publisher

* EventBridge Event via rsc-core

### Example

```json
{
  "detail-type": "Add Tenant",
  "source": "rsc-core",
  "detail": {
    "id": "readysetcloud",
    "name": "Ready, Set, Cloud!",
    "email": "allenheltondev@gmail.com",
    "github": {
      "owner": "readysetcloud",
      "repo": "ready-set-cloud"
    },
    "apiKeys": {
      "sendgrid": "sendgridapikey",
      "github": "githubPAT"
    }
  }
}
```
