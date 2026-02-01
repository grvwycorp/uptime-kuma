# Self-Hosted GitHub Runners Setup Guide

This guide walks through setting up self-hosted GitHub Actions runners in your organization, deployed on your VPS and Debianbook.

## Overview

```
GitHub Organization
       │
       ├── Runner: vps-central (VPS #1) ─── Builds & deploys central
       │
       └── Runner: debianbook (Debianbook) ─── Builds & deploys probe
```

Organization-level runners can be shared across all repos in the org, or restricted to specific repos.

---

## Part 1: Create Organization Runner Group (GitHub Web)

### Step 1.1: Access Organization Settings

1. Go to `https://github.com/YOUR-ORG-NAME`
2. Click **Settings** (top tab)
3. Left sidebar: **Actions** → **Runners**

### Step 1.2: Create a Runner Group (Optional but Recommended)

Runner groups let you control which repos can use which runners.

1. Click **New runner group**
2. Name: `uptime-kuma-infra`
3. Repository access: Select **Selected repositories** → choose your uptime-kuma fork
4. Click **Create group**

---

## Part 2: Deploy Runner on VPS (Central Node)

### Step 2.1: Get Runner Token from GitHub

1. In your org's **Settings** → **Actions** → **Runners**
2. Click **New self-hosted runner**
3. Select:
   - **Operating system**: Linux
   - **Architecture**: x64
4. **Don't close this page** - you'll need the token shown

### Step 2.2: SSH to Your VPS

```bash
ssh root@your-vps-ip
```

### Step 2.3: Create Runner User (Security Best Practice)

```bash
# Create dedicated user for the runner
useradd -m -s /bin/bash github-runner
usermod -aG docker github-runner  # Allow Docker access

# Switch to runner user
su - github-runner
```

### Step 2.4: Download and Configure Runner

```bash
# Create directory
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download latest runner (check GitHub page for current version)
curl -o actions-runner-linux-x64-2.321.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz

# Extract
tar xzf ./actions-runner-linux-x64-2.321.0.tar.gz

# Configure - USE YOUR TOKEN FROM GITHUB
./config.sh --url https://github.com/YOUR-ORG-NAME \
  --token YOUR_TOKEN_FROM_GITHUB \
  --name vps-central \
  --labels vps,central,linux \
  --runnergroup uptime-kuma-infra \
  --work _work
```

**Configuration prompts:**
- Runner group: Enter the group name or press Enter for default
- Runner name: `vps-central`
- Labels: `vps,central,linux` (comma-separated, used in workflows)
- Work folder: `_work` (press Enter for default)

### Step 2.5: Install as System Service

```bash
# Exit back to root
exit

# Install the service (as root)
cd /home/github-runner/actions-runner
./svc.sh install github-runner

# Start the service
./svc.sh start

# Check status
./svc.sh status
```

### Step 2.6: Verify Runner is Online

Go back to GitHub: **Organization Settings** → **Actions** → **Runners**

You should see `vps-central` with a green "Idle" status.

---

## Part 3: Deploy Runner on Debianbook

### Step 3.1: Get Another Runner Token

1. In GitHub: **Organization Settings** → **Actions** → **Runners**
2. Click **New self-hosted runner** again
3. Select Linux/x64
4. Copy the new token (tokens are single-use)

### Step 3.2: On Debianbook Terminal

```bash
# Create dedicated user
sudo useradd -m -s /bin/bash github-runner
sudo usermod -aG docker github-runner

# Switch to runner user
sudo su - github-runner

# Create directory
mkdir -p ~/actions-runner && cd ~/actions-runner

# Download runner
curl -o actions-runner-linux-x64-2.321.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz

# Extract
tar xzf ./actions-runner-linux-x64-2.321.0.tar.gz

# Configure
./config.sh --url https://github.com/YOUR-ORG-NAME \
  --token YOUR_NEW_TOKEN \
  --name debianbook \
  --labels debianbook,probe,linux \
  --runnergroup uptime-kuma-infra \
  --work _work
```

### Step 3.3: Install as Service

```bash
# Exit to your regular user (with sudo)
exit

# Install service
cd /home/github-runner/actions-runner
sudo ./svc.sh install github-runner
sudo ./svc.sh start
sudo ./svc.sh status
```

---

## Part 4: Verify Both Runners

### In GitHub UI

Go to **Organization Settings** → **Actions** → **Runners**

You should see:
```
┌─────────────┬────────────────────────┬────────┐
│ Name        │ Labels                 │ Status │
├─────────────┼────────────────────────┼────────┤
│ vps-central │ vps, central, linux    │ Idle   │
│ debianbook  │ debianbook, probe, linux│ Idle   │
└─────────────┴────────────────────────┴────────┘
```

---

## Part 5: Test the Runners

Create a test workflow to verify everything works.

### Step 5.1: Create Test Workflow

In your repo, create `.github/workflows/test-runners.yml`:

```yaml
name: Test Runners

on:
  workflow_dispatch:  # Manual trigger

jobs:
  test-vps:
    runs-on: [self-hosted, vps]
    steps:
      - name: Check environment
        run: |
          echo "Running on: $(hostname)"
          echo "User: $(whoami)"
          echo "Docker version: $(docker --version)"
          echo "Working directory: $(pwd)"

  test-debianbook:
    runs-on: [self-hosted, debianbook]
    steps:
      - name: Check environment
        run: |
          echo "Running on: $(hostname)"
          echo "User: $(whoami)"
          echo "Docker version: $(docker --version)"
          echo "Working directory: $(pwd)"
```

### Step 5.2: Run the Test

1. Go to your repo on GitHub
2. Click **Actions** tab
3. Select **Test Runners** workflow
4. Click **Run workflow**
5. Watch both jobs execute on their respective runners

---

## Part 6: Runner Management Commands

### Service Management (on each machine)

```bash
# Check status
sudo /home/github-runner/actions-runner/svc.sh status

# Stop runner
sudo /home/github-runner/actions-runner/svc.sh stop

# Start runner
sudo /home/github-runner/actions-runner/svc.sh start

# Restart runner
sudo /home/github-runner/actions-runner/svc.sh stop && sudo /home/github-runner/actions-runner/svc.sh start

# Uninstall service
sudo /home/github-runner/actions-runner/svc.sh uninstall
```

### View Runner Logs

```bash
# Systemd journal
sudo journalctl -u actions.runner.YOUR-ORG-NAME.vps-central.service -f

# Or runner's own logs
tail -f /home/github-runner/actions-runner/_diag/*.log
```

### Update Runner

When GitHub releases new runner versions:

```bash
sudo /home/github-runner/actions-runner/svc.sh stop
cd /home/github-runner/actions-runner

# Download new version
curl -o actions-runner-linux-x64-NEW_VERSION.tar.gz -L https://github.com/actions/runner/releases/download/vNEW_VERSION/actions-runner-linux-x64-NEW_VERSION.tar.gz
tar xzf ./actions-runner-linux-x64-NEW_VERSION.tar.gz

sudo /home/github-runner/actions-runner/svc.sh start
```

---

## Part 7: Security Considerations

### Runner User Permissions

The `github-runner` user needs:
- Docker access (for building/running containers)
- Read/write to repo clone directory
- Network access to GitHub and your other nodes

### Secrets Handling

- **Never** put secrets in workflow files
- Use GitHub **Organization Secrets**: Settings → Secrets and variables → Actions
- Secrets are injected as environment variables at runtime

### Add Organization Secrets

1. **Organization Settings** → **Secrets and variables** → **Actions**
2. Click **New organization secret**
3. Add secrets like:
   - `DB_PASSWORD` - MariaDB password
   - `SSH_PRIVATE_KEY` - For deploying to other nodes (Phase 6)

---

## Troubleshooting

### Runner Shows Offline

```bash
# Check if service is running
sudo systemctl status actions.runner.*.service

# Check network connectivity to GitHub
curl -I https://github.com

# Check runner logs
sudo journalctl -u actions.runner.*.service -n 50
```

### Permission Denied for Docker

```bash
# Ensure user is in docker group
sudo usermod -aG docker github-runner

# Restart runner service
sudo /home/github-runner/actions-runner/svc.sh restart
```

### Runner Can't Clone Repo

For private repos in an organization:
1. The runner automatically uses a GITHUB_TOKEN
2. Ensure the runner group has access to the repo
3. Check: **Org Settings** → **Actions** → **Runner groups** → Edit group → Repository access

---

## Next Steps

Once both runners show "Idle" in GitHub:

1. ✅ Runners are ready
2. → Set up Tailscale on both machines
3. → Deploy central stack on VPS
4. → Deploy probe on Debianbook
