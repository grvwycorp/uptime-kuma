#!/bin/bash
set -e

# =============================================================================
# GitHub Actions Runner Setup Script for grvwycorp
# Run as root: bash setup-runner.sh
# =============================================================================

# =============================================================================
# Configuration
# Same token works on multiple machines within 1 hour!
# Get from: https://github.com/organizations/grvwycorp/settings/actions/runners/new
# =============================================================================
RUNNER_TOKEN="${RUNNER_TOKEN:-}"  # Pass as: RUNNER_TOKEN=xxx bash setup-runner.sh
RUNNER_PAT="${RUNNER_PAT:-}"      # Pass as: RUNNER_PAT=xxx bash setup-runner.sh
RUNNER_NAME="${RUNNER_NAME:-$(hostname)}"
RUNNER_LABELS="${RUNNER_LABELS:-linux,self-hosted}"
RUNNER_HOST_LABEL="${RUNNER_NAME}"
ORG_NAME="grvwycorp"
RUNNER_USER="grvwycorp-runner"
RUNNER_VERSION="2.331.0"
RUNNER_HASH="5fcc01bd546ba5c3f1291c2803658ebd3cedb3836489eda3be357d41bfcf28a7"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }

. /etc/os-release

case "${ID}" in
    ubuntu|debian)
        DOCKER_REPO_OS="${ID}"
        ;;
    *)
        error "Unsupported distro for Docker repo setup: ${ID}"
        ;;
esac

if [[ -z "${VERSION_CODENAME:-}" ]]; then
    error "VERSION_CODENAME is not set in /etc/os-release"
fi

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   error "This script must be run as root"
fi

# Check if auth provided
if [[ -z "$RUNNER_PAT" && -z "$RUNNER_TOKEN" ]]; then
    echo ""
    echo "=============================================="
    echo "  GitHub Runner Authentication Required"
    echo "=============================================="
    echo ""
    echo "Recommended: use a GitHub PAT for org-level registration"
    echo "  Classic PAT scopes: admin:org"
    echo "  Fine-grained PAT: organization permission 'Self-hosted runners: Write'"
    echo ""
    read -r -s -p "Enter GitHub PAT (leave blank to use a runner registration token): " RUNNER_PAT
    echo ""

    if [[ -z "$RUNNER_PAT" ]]; then
        echo ""
        echo "Get your runner registration token from:"
        echo "  https://github.com/organizations/${ORG_NAME}/settings/actions/runners/new"
        echo ""
        read -r -s -p "Enter runner token: " RUNNER_TOKEN
        echo ""
    fi

    echo ""
fi

if [[ -z "$RUNNER_PAT" && -z "$RUNNER_TOKEN" ]]; then
    error "A GitHub PAT or runner token is required"
fi

# Prompt for runner name and labels
echo ""
echo "Runner name [${RUNNER_NAME}]: "
read -r input
RUNNER_NAME="${input:-$RUNNER_NAME}"

echo "Runner labels (comma-separated) [${RUNNER_LABELS}]: "
read -r input
RUNNER_LABELS="${input:-$RUNNER_LABELS}"

if [[ ",${RUNNER_LABELS}," != *",${RUNNER_HOST_LABEL},"* ]]; then
    RUNNER_LABELS="${RUNNER_LABELS},${RUNNER_HOST_LABEL}"
fi

echo ""
log "Configuration:"
echo "    Org:      ${ORG_NAME}"
echo "    Name:     ${RUNNER_NAME}"
echo "    Labels:   ${RUNNER_LABELS}"
echo "    User:     ${RUNNER_USER}"
if [[ -n "$RUNNER_PAT" ]]; then
    echo "    Auth:     PAT"
else
    echo "    Auth:     Registration token"
fi
echo ""

# =============================================================================
# Part 1: Install Docker
# =============================================================================
log "Installing Docker prerequisites..."
rm -f /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/docker.sources
apt update
apt install -y ca-certificates curl

log "Adding Docker GPG key..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${DOCKER_REPO_OS}/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

log "Adding Docker repository..."
tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/${DOCKER_REPO_OS}
Suites: ${VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

log "Installing Docker..."
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

log "Verifying Docker installation..."
docker --version
docker compose version

# =============================================================================
# Part 2: Create Runner User
# =============================================================================
log "Creating runner user: ${RUNNER_USER}..."
if id "$RUNNER_USER" &>/dev/null; then
    warn "User ${RUNNER_USER} already exists, skipping creation"
else
    useradd -m -s /bin/bash "$RUNNER_USER"
fi

log "Adding ${RUNNER_USER} to docker group..."
usermod -aG docker "$RUNNER_USER"

# =============================================================================
# Part 3: Download and Configure Runner
# =============================================================================
RUNNER_HOME="/home/${RUNNER_USER}"
RUNNER_DIR="${RUNNER_HOME}/actions-runner"

log "Setting up runner directory..."
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

log "Downloading GitHub Actions Runner v${RUNNER_VERSION}..."
curl -o actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz -L \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

log "Validating checksum..."
echo "${RUNNER_HASH}  actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" | sha256sum -c

log "Extracting runner..."
tar xzf ./actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

# =============================================================================
# Part 4: Install Runner Dependencies (.NET Core / libicu)
# =============================================================================
log "Installing runner dependencies (libicu for .NET Core)..."
./bin/installdependencies.sh

log "Setting ownership..."
chown -R "${RUNNER_USER}:${RUNNER_USER}" "$RUNNER_DIR"

# =============================================================================
# Part 5: Configure Runner
# =============================================================================
log "Configuring runner..."
if [[ -n "$RUNNER_PAT" ]]; then
    su -s /bin/bash - "$RUNNER_USER" -c \
        "cd '$RUNNER_DIR' && ./config.sh \
            --url 'https://github.com/${ORG_NAME}' \
            --pat '${RUNNER_PAT}' \
            --name '${RUNNER_NAME}' \
            --labels '${RUNNER_LABELS}' \
            --unattended \
            --replace"
else
    su -s /bin/bash - "$RUNNER_USER" -c \
        "cd '$RUNNER_DIR' && ./config.sh \
            --url 'https://github.com/${ORG_NAME}' \
            --token '${RUNNER_TOKEN}' \
            --name '${RUNNER_NAME}' \
            --labels '${RUNNER_LABELS}' \
            --unattended \
            --replace"
fi

# =============================================================================
# Part 6: Install and Start Service
# =============================================================================
log "Installing runner as service..."
cd "$RUNNER_DIR"
./svc.sh install "$RUNNER_USER"

log "Starting runner service..."
./svc.sh start

log "Checking service status..."
./svc.sh status

# =============================================================================
# Done!
# =============================================================================
echo ""
echo "=============================================="
echo -e "${GREEN}  Runner Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "Runner: ${RUNNER_NAME}"
echo "User:   ${RUNNER_USER}"
echo "Dir:    ${RUNNER_DIR}"
echo ""
echo "Check status: ${RUNNER_DIR}/svc.sh status"
echo "View logs:    journalctl -u actions.runner.${ORG_NAME}.${RUNNER_NAME}.service -f"
echo ""
echo "Verify at: https://github.com/organizations/${ORG_NAME}/settings/actions/runners"
echo ""
