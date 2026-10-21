# Bounce handling and SES guidance review

## Implemented policy

`HandleDeliveryHealthFunction` independently consumes SES bounce and delivery
events. It resolves marketing tenant tags (including welcome mail) and legacy
issue references, and operates on the event's affected recipient list. Admin
messages without marketing/issue tags cannot remove a subscription.

- Permanent bounce: immediately record durable suppression, then remove the
  subscriber and decrement the count together.
- Suppressed bounce: the same immediate action.
- Transient bounce: suppress after three consecutive distinct SES message IDs
  fail. This is our policy, not an AWS-mandated three-strike threshold.
- Delivery: reset the temporary streak in send-time order.
- Undetermined bounce: record as unknown; it does not prove an invalid mailbox.
- SES reject: retain analytics but do not infer that the recipient is invalid.
- Complaint: existing complaint handler immediately suppresses and removes.

Event redelivery cannot advance the streak. History is ordered by original SES
send timestamp rather than callback arrival, and bounded to 50 recent messages.
An old soft bounce cannot reset a newer delivery. Delivery for a suppressed
address never automatically restores consent or removes a suppression.
Temporary streak history begins when this handler is deployed; historical issue
`failedAddresses` cannot safely supply it because that list mixes failure types.

Health state and suppression commit in one transaction guarded by a revision.
Existing opt-out records and verified ownership flags are preserved. If subscriber
removal fails, suppression already blocks mail and imports, and a replay retries
removal without adding another failure. Failures propagate to Lambda retries and
the shared 14-day email pipeline DLQ. A dedicated error alarm alerts on failures.

The scheduled cleanup is now reconciliation: page the tenant's real subscribers
and the regional SES account suppression list, durably suppress matching bounce
and complaint entries, then remove them. It no longer deletes addresses because
they failed two adjacent issues. This also covers historical SES suppressions.
Reads and removal failures are retryable instead of returning false success.
The existing scheduled event and explicit manual invocation both work.

Marketing sends check suppression when selecting the audience and again before
dispatching each recipient. This catches bounce/complaint events arriving during
a blast, though no cross-service check can recall a send already handed to SES.
The subscriber-removal count condition uses supported DynamoDB syntax.

## AWS guidance status

Review performed 2026-10-19 in us-east-1; changes below are not deployed yet.

| Area | Findings and action |
|---|---|
| Hard bounces and complaints | Immediate, durable exclusion implemented; scheduled SES reconciliation added for older records. |
| SES automatic suppression | Account already enables BOUNCE and COMPLAINT. Added both explicitly to the configuration set in IaC. |
| Reputation monitoring | No newsletter-prefixed SES alarms found. Added account rate alarms at 2% bounces and 0.1% complaints, using AWS reputation metrics rather than issue totals. Missing data preserves alarm state. Alerts use the existing critical alerts SNS topic. |
| Authentication | readysetcloud.io is verified, DKIM is SUCCESS with signing enabled, and custom MAIL FROM bounce.readysetcloud.io is SUCCESS. DNS publishes SES SPF and DMARC p=quarantine. No DNS change required. |
| Unsubscribe | Existing one-click headers and durable opt-out enforcement retained. |
| Confirmed opt-in | Still missing. Recommended next: confirmation email plus expiring ownership token; no welcome/newsletter until confirmed. Bot classification is not proof of ownership. This needs its own token, consent and resend design. |
| Acquisition and re-engagement | Investigate signup sources and audit existing subscribers. Review old/inactive cohorts before large sends; scanner/proxy opens are not reliable evidence of human engagement. Do not automatically delete people based only on low opens. |
| Forms | AWS also suggests entering an email twice. Evaluate alongside confirmation UX; it does not stop automated registrations. |
| Tests | Use local mocks and AWS mailbox simulator for any future end-to-end delivery tests, rather than invented real addresses. No live mail sent by this change. |
| Probation response | Account still reports PROBATION. After deployment and verification, respond to the existing AWS Support case with evidence of the actual fixes and acquisition controls. No support message has been sent. |

Before the next issue: deploy, smoke-test with the SES mailbox simulator, invoke
SES reconciliation for the tenant, inspect the private subscriber audit and DLQ,
and verify the account's reputation trend. A code change alone does not resolve
an AWS review. Do not claim confirmed opt-in is implemented in the support reply.

Validation: the delivery-health resources pass an isolated CloudFormation/SAM
lint check. Full-template validation still encounters the pre-existing public
API `Authorizer: NONE` transformation errors; resolve those before deployment.

Sources:
- [SES enforcement and list-management guidance](https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html)
- [SES bounce notification types](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html)
- [SES reputation alarms](https://docs.aws.amazon.com/ses/latest/dg/reputationdashboard-cloudwatch-alarm.html)
- [Configuration-set suppression options](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ses-configurationset-suppressionoptions.html)

Historical SES suppression reconciliation does not increment any issue's cleaned
counter: the account list does not identify an originating issue. Only the live
delivery path attributes removals using the message's issuePk.
