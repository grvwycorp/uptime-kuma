#!/bin/bash
# =============================================================================
# Iris probe cloud-init bootstrap
# -----------------------------------------------------------------------------
# Paste this into the Oracle Cloud "Initialization script" box (Advanced
# options → Management) when LAUNCHING the instance. cloud-init runs it once,
# as root, on first boot. It sets up everything a probe host needs:
#   0. hostname (everything keys off `hostname -s`)
#   1. base packages
#   2. Docker (so the Deploy workflow can `docker compose pull && up`)
#   3. Tailscale — joins the tailnet (how the probe is reached; NO public ports)
#   4. GitHub Actions self-hosted runner (CPU arch auto-detected: x64 / arm64)
#
# After this completes, the runner appears under the grvwycorp org and the
# "Deploy Iris" workflow pulls the pre-built GHCR image and runs the probe —
# no SSH required.
#
# Substitute the three __PLACEHOLDER__ values before pasting. The runner token
# is short-lived (~1h) so generate it right before you launch the instance.
# Progress/errors are logged to /var/log/iris-bootstrap.log on the instance.
# =============================================================================
set -euxo pipefail
exec > /var/log/iris-bootstrap.log 2>&1

PROBE_HOSTNAME="__PROBE_HOSTNAME__"        # e.g. probe04-oraclesto
TAILSCALE_AUTHKEY="__TAILSCALE_AUTHKEY__"  # reusable+ephemeral key, tag:iris-probe
RUNNER_TOKEN="__RUNNER_TOKEN__"            # org runner registration token (~1h TTL)
NODE_LOCATION="stockholm"

ORG_NAME="grvwycorp"
RUNNER_USER="grvwycorp-runner"
RUNNER_VERSION="2.331.0"
RUNNER_HASH_X64="5fcc01bd546ba5c3f1291c2803658ebd3cedb3836489eda3be357d41bfcf28a7"
RUNNER_HASH_ARM64="f5863a211241436186723159a111f352f25d5d22711639761ea24c98caef1a9a"

# --- 0. hostname ----------------------------------------------------------
hostnamectl set-hostname "${PROBE_HOSTNAME}"

# --- 1. base packages -----------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl jq

# --- 2. Docker (official repo) --------------------------------------------
. /etc/os-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/${ID}
Suites: ${VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# --- 3. Tailscale (join tailnet) ------------------------------------------
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up \
    --authkey="${TAILSCALE_AUTHKEY}" \
    --hostname="${PROBE_HOSTNAME}" \
    --advertise-tags="tag:iris-probe,tag:loc-${NODE_LOCATION}" \
    --accept-routes --accept-dns

# --- 4. GitHub Actions runner (arch auto-detect) --------------------------
case "$(uname -m)" in
    x86_64|amd64)  RUNNER_ARCH="x64";   RUNNER_HASH="${RUNNER_HASH_X64}" ;;
    aarch64|arm64) RUNNER_ARCH="arm64"; RUNNER_HASH="${RUNNER_HASH_ARM64}" ;;
    *) echo "Unsupported CPU arch for runner: $(uname -m)" >&2; exit 1 ;;
esac

id "${RUNNER_USER}" &>/dev/null || useradd -m -s /bin/bash "${RUNNER_USER}"
usermod -aG docker "${RUNNER_USER}"

RUNNER_DIR="/home/${RUNNER_USER}/actions-runner"
mkdir -p "${RUNNER_DIR}"
cd "${RUNNER_DIR}"

TARBALL="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
curl -o "${TARBALL}" -L \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"
echo "${RUNNER_HASH}  ${TARBALL}" | sha256sum -c
tar xzf "./${TARBALL}"
./bin/installdependencies.sh
chown -R "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_DIR}"

su -s /bin/bash - "${RUNNER_USER}" -c "cd '${RUNNER_DIR}' && ./config.sh \
    --url 'https://github.com/${ORG_NAME}' \
    --token '${RUNNER_TOKEN}' \
    --name '${PROBE_HOSTNAME}' \
    --labels 'self-hosted,probe,${PROBE_HOSTNAME}' \
    --unattended --replace"

./svc.sh install "${RUNNER_USER}"
./svc.sh start
./svc.sh status

echo "=== Iris probe bootstrap complete: ${PROBE_HOSTNAME} ==="
