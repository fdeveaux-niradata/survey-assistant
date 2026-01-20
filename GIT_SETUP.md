# Git Setup for Multiple GitHub Accounts

You have two GitHub accounts with separate SSH keys:

| Account | SSH Key | Host Alias |
|---------|---------|------------|
| Personal (`fdeveaux`) | `~/.ssh/id_ed25519` | `github.com` |
| Nira Data (`fdeveaux-niradata`) | `~/.ssh/id_ed25519_niradata` | `github-niradata` |

## SSH Config File

Your SSH config should be at `~/.ssh/config`. If it's missing, restore from backup:

```bash
cp ~/.ssh/config.save ~/.ssh/config
```

The config file contents:

```
# Academic GitHub account
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes

# NiraData GitHub account
Host github-niradata
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_niradata
  IdentitiesOnly yes
```

## Pushing to Nira Data GitHub

When working with Nira Data repos, use `github-niradata` instead of `github.com`:

### Clone a Nira Data repo:
```bash
git clone git@github-niradata:fdeveaux-niradata/REPO_NAME.git
```

### Add remote to existing project:
```bash
git remote add origin git@github-niradata:fdeveaux-niradata/REPO_NAME.git
```

### Fix remote if it's using wrong host:
```bash
git remote set-url origin git@github-niradata:fdeveaux-niradata/REPO_NAME.git
```

### Push:
```bash
git push -u origin main
```

## Pushing to Personal GitHub

Use the standard `github.com`:

```bash
git clone git@github.com:fdeveaux/REPO_NAME.git
git remote add origin git@github.com:fdeveaux/REPO_NAME.git
```

## Troubleshooting

**"Permission denied" error:**
- Check which host alias you're using in the remote URL
- Verify SSH config exists: `cat ~/.ssh/config`
- Test SSH connection: `ssh -T git@github-niradata`

**Check current remote:**
```bash
git remote -v
```

**Check which SSH keys are loaded:**
```bash
ssh-add -l
```
