# Sending a single test email

`SendTestEmailFunction` is an on-demand harness for previewing a newsletter
issue without publishing it. It runs raw markdown through the **real**
`parse-md-to-json` → `publish-issue` (preview) pipeline, so body shortcodes such
as `{{< robotVoice text="..." >}}` render exactly as they do for a live issue,
then sends **one** `[Preview]` email to an address you choose.

It does **not** write an issue record, schedule jobs, touch the subscriber list,
or call back to GitHub. It always sends via the preview path (`to.email`, a
single recipient) and never reads or sends to the subscriber list, so it is safe
to run in production as well as stage/sandbox.

## Prerequisites

- The tenant must have a **verified default sender** configured (the actual SES
  send is performed by `send-email-v2`, which validates the sender).
- Deploy the stack so the function exists in the target environment.

## How to run it (AWS Lambda console)

1. Open the Lambda console and find the function whose name contains
   `SendTestEmailFunction`.
2. **Test** tab → create a new test event with one of the payloads below.
3. **Test**. The single preview email lands in the inbox you specified.

### Option A — paste raw markdown

The `content` must include the usual frontmatter (`title`, `date`).

```json
{
  "tenantId": "<your-tenant-id>",
  "email": "you@example.com",
  "content": "---\ntitle: Robot Voice Test\ndate: 2026-06-26\n---\n### A Section\n{{< robotVoice text=\"beep boop, I am a robot\" >}}"
}
```

### Option B — pull a file straight from the content repo

Fetches the file from the tenant's configured content repo (e.g.
`readysetcloud/ready-set-cloud`).

```json
{
  "tenantId": "<your-tenant-id>",
  "email": "you@example.com",
  "fileName": "content/newsletter/123.md",
  "branchName": "main"
}
```

### Optional fields

| Field        | Default | Notes                                                       |
| ------------ | ------- | ----------------------------------------------------------- |
| `issueId`    | `999`   | Issue number used for metadata/links.                       |
| `templateId` | `null`  | Tenant template id; `null` uses the default newsletter template. |

## Testing robotVoice specifically

Drop a `{{< robotVoice text="..." >}}` shortcode inside a `### Section`, send it
to yourself, and open it in the clients that matter — Gmail, Apple Mail, and
Outlook — to confirm the notch labels render (and that Outlook falls back to the
flat MSO version).
