#!/bin/bash
set -e

# =============================================================================
# Tailscale Setup Script for Iris Fleet
# Run as root: bash setup-tailscale.sh
# =============================================================================

# Configuration
TAILSCALE_AUTHKEY="${TAILSCALE_AUTHKEY:-}"
NODE_HOSTNAME="${NODE_HOSTNAME:-$(hostname -s)}"
NODE_ROLE="${NODE_ROLE:-probe}"  # "master" or "probe"
NODE_LOCATION="${NODE_LOCATION:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }

# Check root
if [[ $EUID -ne 0 ]]; then
   error "This script must be run as root"
fi

# =============================================================================
# Interactive prompts if not provided via env vars
# =============================================================================
if [[ -z "$TAILSCALE_AUTHKEY" ]]; then
    echo ""
    echo "=============================================="
    echo "  Tailscale Auth Key Required"
    echo "=============================================="
    echo ""
    echo "Get an auth key from: https://login.tailscale.com/admin/settings/keys"
    echo "Recommended: Create a reusable, ephemeral key with tags"
    echo ""
    read -p "Enter Tailscale auth key: " TAILSCALE_AUTHKEY
fi

if [[ -z "$TAILSCALE_AUTHKEY" ]]; then
    error "Tailscale auth key is required"
fi

echo ""
echo "Node hostname for MagicDNS [${NODE_HOSTNAME}]: "
read -r input
NODE_HOSTNAME="${input:-$NODE_HOSTNAME}"

echo "Node role (master/probe) [${NODE_ROLE}]: "
read -r input
NODE_ROLE="${input:-$NODE_ROLE}"

echo "Node location (e.g., frankfurt, nuremberg) [${NODE_LOCATION}]: "
read -r input
NODE_LOCATION="${input:-$NODE_LOCATION}"

# Build tags
TAGS="tag:iris-${NODE_ROLE}"
if [[ -n "$NODE_LOCATION" ]]; then
    TAGS="${TAGS},tag:loc-${NODE_LOCATION}"
fi

echo ""
log "Configuration:"
echo "    Hostname: ${NODE_HOSTNAME}"
echo "    Role:     ${NODE_ROLE}"
echo "    Location: ${NODE_LOCATION:-not set}"
echo "    Tags:     ${TAGS}"
echo ""

# =============================================================================
# Install Tailscale
# =============================================================================
if command -v tailscale &> /dev/null; then
    warn "Tailscale already installed, skipping installation"
else
    log "Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh
fi

# =============================================================================
# Configure and Start Tailscale
# =============================================================================
log "Starting Tailscale..."

# Check if already connected
if tailscale status &> /dev/null; then
    warn "Tailscale already connected"

    # Update hostname if different
    CURRENT_HOSTNAME=$(tailscale status --json | jq -r '.Self.HostName')
    if [[ "$CURRENT_HOSTNAME" != "$NODE_HOSTNAME" ]]; then
        log "Updating hostname from ${CURRENT_HOSTNAME} to ${NODE_HOSTNAME}..."
        tailscale set --hostname="${NODE_HOSTNAME}"
    fi
else
    log "Authenticating with Tailscale..."
    tailscale up \
        --authkey="${TAILSCALE_AUTHKEY}" \
        --hostname="${NODE_HOSTNAME}" \
        --advertise-tags="${TAGS}" \
        --accept-routes \
        --accept-dns
fi

# =============================================================================
# Verify Connection
# =============================================================================
log "Verifying Tailscale connection..."
sleep 2

tailscale status

echo ""
TAILSCALE_IP=$(tailscale ip -4)
log "Tailscale IPv4: ${TAILSCALE_IP}"

# =============================================================================
# Done
# =============================================================================
echo ""
echo "=============================================="
echo -e "${GREEN}  Tailscale Setup Complete!${NC}"
echo "=============================================="
echo ""
echo "Hostname:      ${NODE_HOSTNAME}"
echo "Tailscale IP:  ${TAILSCALE_IP}"
echo "Tags:          ${TAGS}"
echo ""
echo "MagicDNS name: ${NODE_HOSTNAME} (accessible from other Tailscale nodes)"
echo ""
echo "Test connectivity: tailscale ping master01-hostup"
echo ""
