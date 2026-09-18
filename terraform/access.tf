# Worker を自分のアカウントのメールだけに閉じる。
# IdP を設定していなくても Access の One-time PIN（メールOTP）で認証できる。
#
# 注意: これは hostname 単位の保護。Worker 自体に Access を付ける新API
# （2026-08 の Worker-level Access）は provider v4 に無いため、当面は
# 実際に配信している workers.dev のホスト名を対象にする。
resource "cloudflare_zero_trust_access_application" "kitchen" {
  account_id                = var.account_id
  name                      = "jev-kitchen"
  domain                    = var.access_hostname
  type                      = "self_hosted"
  session_duration          = var.access_session_duration
  app_launcher_visible      = false
  auto_redirect_to_identity = false
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
