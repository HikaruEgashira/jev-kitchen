output "url" {
  value = "https://${cloudflare_workers_domain.main.hostname}"
}
