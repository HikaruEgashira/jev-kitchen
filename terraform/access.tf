# Worker を自分のアカウントのメールだけに閉じる。
# IdP を設定していなくても Access の One-time PIN（メールOTP）で認証できる。
#
# workers.dev と custom domain の両方を対象にする。片方だけだと、Terraform が
# custom domain を作った瞬間にそちらが素通りになる。
# Worker 自体に Access を付ける新API（2026-08 の Worker-level Access）は
# provider v4 に無いため、hostname 単位で保護している。
locals {
  protected_hosts = [
    var.access_hostname,
    "${var.subdomain}.${var.domain}",
  ]
}

resource "cloudflare_zero_trust_access_application" "kitchen" {
  account_id           = var.account_id
  name                 = "jev-kitchen"
  type                 = "self_hosted"
  session_duration     = var.access_session_duration
  app_launcher_visible = false
  self_hosted_domains  = local.protected_hosts
}

resource "cloudflare_zero_trust_access_policy" "owner_only" {
  account_id     = var.account_id
  application_id = cloudflare_zero_trust_access_application.kitchen.id
  name           = "owner only"
  decision       = "allow"
  precedence     = 1

  include {
    email = [var.owner_email]
  }
}
