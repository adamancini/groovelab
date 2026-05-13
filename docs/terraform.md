# Terraform Modules

## Overview

Groovelab provides generated Terraform modules for infrastructure-as-code deployments. These modules are available in the Replicated Enterprise Portal and can be enabled or disabled via a custom license field.

## Available Modules

### groovelad-helm

Deploys Groovelab on an existing Kubernetes cluster using the Helm chart.

```hcl
module "groovelab" {
  source = "https://groovelab.enterprise.replicated.com/terraform/groovelab-helm"
  
  license_file = file("license.yaml")
  namespace    = "groovelab"
  
  # Optional overrides
  values = {
    "replicated.enabled" = "true"
    "cnpg.enabled"      = "true"
  }
}
```

### groovelab-ec

Deploys Groovelab as an Embedded Cluster on a VM instance.

```hcl
module "groovelab_ec" {
  source = "https://groovelab.enterprise.replicated.com/terraform/groovelab-ec"
  
  license_file = file("license.yaml")
  
  # VM configuration
  vm_count     = 1
  vm_cpu       = 4
  vm_memory_gb = 8
  vm_disk_gb   = 50
}
```

## License Field

Terraform module generation is controlled by the `terraform_modules_enabled` license field:

- **Enabled**: `terraform_modules_enabled = "true"` — modules are generated and visible in the portal
- **Disabled**: `terraform_modules_enabled = "false"` or absent — modules are not generated

To enable Terraform modules for a customer:

1. Log in to the [Replicated Vendor Portal](https://vendor.replicated.com)
2. Navigate to the customer's license
3. Add or set the custom field: `terraform_modules_enabled = true`
4. Save the license

The modules will be generated on the next release promotion.

## Downloading Modules

Modules are available in the Enterprise Portal under the **Terraform** section:

1. Visit the Groovelab Enterprise Portal
2. Navigate to **Install > Terraform**
3. Download the module archive or copy the source URL
4. Extract and use in your Terraform configuration

## Requirements

- Terraform 1.5+
- Valid Groovelab license file
- (Helm module) Existing Kubernetes cluster with kubectl configured
- (EC module) VM instances with SSH access

## Notes

- Terraform modules are generated from the Helm chart and Embedded Cluster configuration
- Module versions match the application release version
- Modules include preflight checks to validate prerequisites before deployment
