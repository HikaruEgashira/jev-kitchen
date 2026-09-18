output "url" {
  value = "https://${cloudflare_workers_domain.main.hostname}"
}

output "access_aud" {
  description = "Application Audience tag, needed only if the Worker validates the Access JWT itself"
  value       = cloudflare_zero_trust_access_application.kitchen.aud
}
