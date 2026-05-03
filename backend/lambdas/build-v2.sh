#!/usr/bin/env bash
#
# Build helper for Matika v2 (TypeScript) Lambdas.
#
# Run before `terraform apply` whenever Lambda code or dependencies change.
# Produces, for each v2 Lambda:
#   - dist/   (compiled JS from `tsc`)
#   - node_modules/ pruned to production deps only
#
# Terraform's archive_file (in modules/lambda/main_v2.tf) then zips the dir
# minus src/__tests__/configs (see local.v2_archive_excludes).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAMBDAS_DIR="${REPO_ROOT}/backend/lambdas"

V2_LAMBDAS=(
  "bedrock-router"
  "bedrock-vision"
  "cost-telemetry-rollup"
  "health-check"
  "photo-presign"
)

echo "==> Building v2 Lambdas in ${LAMBDAS_DIR}"

for fn in "${V2_LAMBDAS[@]}"; do
  dir="${LAMBDAS_DIR}/${fn}"
  if [[ ! -d "${dir}" ]]; then
    echo "  SKIP ${fn} — directory not found"
    continue
  fi

  echo "==> ${fn}"
  pushd "${dir}" >/dev/null

  # Fresh, lockfile-faithful install (includes devDeps for tsc).
  npm ci --silent

  # Compile TypeScript → dist/
  npm run build --silent

  # Drop devDeps so the final archive is small.
  npm prune --omit=dev --silent

  popd >/dev/null
done

echo "==> Done. Run terraform plan / apply from infrastructure/terraform/environments/dev/"
