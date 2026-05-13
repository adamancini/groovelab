# Self-Serve Sign-Up

## Overview

Groovelab offers self-serve customer sign-up through the Replicated Enterprise Portal. Prospective customers can create their own accounts and download license files without manual vendor intervention.

## Enabling Self-Serve Sign-Up

### Vendor Portal Configuration

1. Log in to the [Replicated Vendor Portal](https://vendor.replicated.com)
2. Navigate to **Channels > Stable**
3. Enable **"Allow self-serve sign-up"** in channel settings
4. Configure the sign-up URL: `https://groovelab.enterprise.replicated.com/signup`
5. (Optional) Set a daily sign-up limit to prevent abuse

### Sign-Up Flow

1. Customer visits the sign-up URL
2. Enters their email address and organization name
3. Receives a verification email with a confirmation link
4. Confirms email and downloads their license file
5. Customer record is automatically created in the Vendor Portal

## Customer Record

Each sign-up creates a customer record with:
- **Name**: Organization name provided during sign-up
- **Email**: Verified email address
- **License**: Auto-generated trial license (30-day default)
- **Channel**: Assigned to the Stable channel

### Viewing Sign-Up Customers

In the Vendor Portal:
1. Go to **Customers**
2. Filter by source: **"Self-serve sign-up"**
3. Review and manage customer licenses

### Converting Trials

To convert a trial customer to a paid license:
1. Navigate to the customer's license page
2. Update license fields (seat count, feature entitlements)
3. Set expiration date or remove expiration for perpetual licenses
4. Save and notify the customer

## Customizations

### Sign-Up Page Branding

The self-serve sign-up page inherits Enterprise Portal branding:
- Logo: `assets/logo.svg`
- Primary color: `#e94560`
- Title: "Groovelab"

### Email Templates

Verification emails are sent from the configured custom sender:
- **From**: `noreply@groovelab.dev` (custom domain with SPF/DKIM)
- **Subject**: "Verify your Groovelab account"
- **Body**: Includes verification link and organization details

### Trial Configuration

Default trial settings (configurable in Vendor Portal):
- **Duration**: 30 days
- **Seats**: 5 users
- **Features**: All features enabled (track export, analytics, Terraform modules)
- **Support**: Community support

## Webhook Notifications

Configure a webhook endpoint to receive real-time notifications for sign-up events:

```json
{
  "event": "customer.created",
  "customer": {
    "id": "3DdhANs0DaWtB3StTKiiPHrQ4kS",
    "name": "Bass Masters Studio",
    "email": "admin@bassmasters.example",
    "license_id": "3DdhANaL0vyNX5TCfSD1WRbIgXM",
    "source": "self-serve-signup"
  },
  "timestamp": "2026-05-12T20:00:00Z"
}
```

## Security Considerations

- Sign-up emails must be verified before license download
- Rate limiting: maximum 5 sign-ups per IP per hour
- Domain blocking: configure disallowed email domains in portal settings
- Manual review: flag sign-ups from suspicious domains for manual approval

## Testing

Test the self-serve flow end-to-end:

```bash
# 1. Visit sign-up URL
curl -I https://groovelab.enterprise.replicated.com/signup

# 2. Submit sign-up form (automated test)
# See: tests/e2e/tier6_test.sh
```

## Next Steps

After sign-up, customers should follow:
- [Helm Installation Guide](helm-install.md)
- [Embedded Cluster Installation Guide](ec-install.md)
