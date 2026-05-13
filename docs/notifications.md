# Notification Configuration

## Overview

Groovelab uses the Replicated Vendor Portal notification system to alert customers and administrators about release promotions, license expirations, and instance status changes.

## Notification Channels

### Email Notifications

#### Configuration

1. Log in to the [Replicated Vendor Portal](https://vendor.replicated.com)
2. Navigate to **Settings > Notifications > Email**
3. Configure the custom sender domain:
   - **Domain**: `groovelab.dev`
   - **Sender Address**: `noreply@groovelab.dev`
   - **Display Name**: Groovelab Notifications

#### SPF Record

Add the following SPF record to your DNS:

```
v=spf1 include:sendgrid.net ~all
```

#### DKIM Record

Replicated will provide a DKIM public key after domain verification. Add the CNAME record as instructed:

```
s1._domainkey.groovelab.dev  CNAME  s1.domainkey.u12345.wl123.sendgrid.net
s2._domainkey.groovelab.dev  CNAME  s2.domainkey.u12345.wl123.sendgrid.net
```

#### Verification

After adding DNS records, click **Verify Domain** in the Vendor Portal. Verification may take up to 24 hours to propagate.

#### Trigger Events

Email notifications are sent for the following events:

| Event | Recipients | Description |
|-------|------------|-------------|
| Release promoted to Stable | License contacts | New version available for download |
| License expiration (7 days) | License contacts | Renewal reminder |
| License expiration (1 day) | License contacts | Urgent renewal reminder |
| Instance status change | Admin contacts | Health check alerts |

### Webhook Notifications

#### Configuration

1. Log in to the [Replicated Vendor Portal](https://vendor.replicated.com)
2. Navigate to **Settings > Notifications > Webhooks**
3. Add webhook endpoint:
   - **URL**: `https://api.groovelab.dev/webhooks/replicated`
   - **Secret**: Generate a random secret for HMAC verification
   - **Events**: Select all relevant events

#### Webhook Payload Format

```json
{
  "event": "release.promoted",
  "timestamp": "2026-05-13T14:00:00Z",
  "app": {
    "id": "3CP6XxXkukJhffkB4phsNbI16pl",
    "slug": "groovelab",
    "name": "Groovelab"
  },
  "release": {
    "sequence": 165,
    "version": "0.1.10",
    "channel": {
      "name": "Stable",
      "slug": "stable"
    }
  },
  "customer": {
    "id": "3DdhANs0DaWtB3StTKiiPHrQ4kS",
    "name": "Bass Masters Studio",
    "email": "admin@bassmasters.example"
  }
}
```

#### Signature Verification

Webhooks include an HMAC-SHA256 signature in the `X-Replicated-Signature` header:

```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)
```

#### Trigger Events

Webhook notifications fire for:

| Event | Description |
|-------|-------------|
| `release.promoted` | Release promoted to a channel |
| `license.created` | New license created |
| `license.updated` | License modified |
| `license.expiring` | License approaching expiration |
| `instance.created` | New instance reported |
| `instance.updated` | Instance status changed |

## Testing Notifications

### Test Email Delivery

1. In the Vendor Portal, navigate to **Settings > Notifications > Email**
2. Click **Send Test Email**
3. Enter a test recipient address
4. Verify the email is received and SPF/DKIM passes

### Test Webhook Delivery

Use a webhook testing service like [webhook.site](https://webhook.site):

1. Generate a temporary webhook URL
2. Add it to the Vendor Portal webhook configuration
3. Trigger a test event (e.g., promote a release to a test channel)
4. Verify the payload is received and the signature is valid

```bash
# Example: using curl to simulate a webhook endpoint for testing
curl -X POST https://webhook.site/your-unique-id \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

## Troubleshooting

### Emails Not Delivering

- **Check SPF/DKIM**: Use `dig TXT groovelab.dev` to verify DNS records
- **Check spam folders**: Ask recipients to whitelist `noreply@groovelab.dev`
- **Verify domain**: Ensure domain verification is complete in the Vendor Portal

### Webhooks Not Firing

- **Check endpoint URL**: Ensure the URL is publicly accessible
- **Check HTTP response**: Endpoint must return 2xx status code
- **Verify secret**: Check HMAC signature if using verification

### Custom Domain Issues

If using a custom domain for the Enterprise Portal:
- Ensure the domain is verified in **Settings > Branding**
- DNS records must be propagated before notifications will work

## Security Considerations

- Webhook secrets should be rotated quarterly
- Email sender domains should have DMARC policies:
  ```
  _dmarc.groovelab.dev  TXT  v=DMARC1; p=quarantine; rua=mailto:dmarc@groovelab.dev
  ```
- Store webhook secrets in a secrets manager (not in code repositories)

## References

- [Replicated Notifications Documentation](https://docs.replicated.com/vendor/notifications)
- [SPF Record Syntax](https://www.open-spf.org/SPF_Record_Syntax/)
- [DKIM Standard](https://tools.ietf.org/html/rfc6376)
