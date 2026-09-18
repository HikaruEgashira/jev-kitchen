variable "cloudflare_api_token" {
  description = "Cloudflare API Token"
  type        = string
  sensitive   = true
}

variable "account_id" {
  description = "Cloudflare Account ID"
  type        = string
}

variable "domain" {
  description = "Zone that owns the custom domain"
  type        = string
  default     = "egahika.dev"
}

variable "subdomain" {
  description = "Hostname label the kitchen is served on"
  type        = string
  default     = "jev-kitchen"
}

variable "worker_name" {
  description = "Worker name deployed by wrangler (wrangler.jsonc `name`)"
  type        = string
  default     = "jev-kitchen"
}
