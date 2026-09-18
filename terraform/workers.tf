# Worker 本体（script と assets）は wrangler が main push でデプロイする。
# Terraform が持つのは「その Worker をどのホスト名で公開するか」だけ。
#
# 依存順: wrangler deploy → terraform apply。
# custom domain は Worker が存在しないと作れないため、初回は deploy を先に流す。
resource "cloudflare_workers_domain" "main" {
  account_id = var.account_id
  zone_id    = data.cloudflare_zone.main.id
  hostname   = "${var.subdomain}.${var.domain}"
  service    = var.worker_name
}
