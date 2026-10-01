#!/usr/bin/env bash
# One-job self-hosted runner bootstrap (adapted from plenoai/pleno-anonymize-demo).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl git libicu74 gcc libc6-dev python3-pip
mkdir -p /opt/actions-runner
cd /opt/actions-runner
curl --fail --location --retry 3 --output runner.tar.gz \
  https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-x64-2.337.0.tar.gz
echo '70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613  runner.tar.gz' | sha256sum --check
tar xzf runner.tar.gz
rm runner.tar.gz
./bin/installdependencies.sh
export RUNNER_ALLOW_RUNASROOT=1
# The controller deletes the Pod; exiting the container alone does not stop billing.
timeout --signal=TERM --kill-after=30s 110m ./run.sh --jitconfig "$RUNNER_JIT_CONFIG"
