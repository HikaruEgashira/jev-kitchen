terraform {
  required_version = ">= 1.10"

  # state は R2（S3 互換 API）で管理する。egahika.dev と同じバケット、key だけ分ける。
  # 認証情報は AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 環境変数
  # （CI では R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY を割り当て）。
  backend "s3" {
    bucket = "terraform-state"
    key    = "jev-kitchen/terraform.tfstate"
    region = "auto"

    endpoints = {
      s3 = "https://44e24c8ee261f0962fa7d1f3b72a6afc.r2.cloudflarestorage.com"
    }

    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

data "cloudflare_zone" "main" {
  name = var.domain
}
