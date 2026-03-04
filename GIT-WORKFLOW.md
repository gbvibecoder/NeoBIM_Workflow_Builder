# 🌿 Git Workflow Rules for NeoBIM Workflow Builder

## 🚨 GOLDEN RULES

1. **NEVER push directly to main** 
2. **ALWAYS create a feature branch**
3. **ALWAYS pull latest main before creating a new branch**
4. **ALWAYS test locally before pushing**
5. **ALWAYS write descriptive commit messages**

## 📝 Branch Naming Convention

```bash
# Features
git checkout -b feature/add-3d-viewer
git checkout -b feature/implement-user-settings

# Bug Fixes  
git checkout -b fix/canvas-drag-issue
git checkout -b fix/auth-redirect-loop

# Refactoring
git checkout -b refactor/workflow-store
git checkout -b refactor/canvas-performance

# Documentation
git checkout -b docs/api-documentation
git checkout -b docs/update-readme

# Performance
git checkout -b perf/optimize-bundle-size
git checkout -b perf/improve-canvas-rendering
```

## 🔄 Workflow Steps

### 1. Start New Work
```bash
# Always start from latest main
git checkout main
git pull origin main

# Create new branch
git checkout -b feature/your-feature-name

# Make your changes...
```

### 2. Commit Your Work
```bash
# Check what changed
git status

# Add files
git add .

# Commit with descriptive message
git commit -m "feat: add real-time collaboration support"
```

### 3. Push Your Branch
```bash
# Push to GitHub
git push origin feature/your-feature-name

# Create PR on GitHub
```

### 4. After PR is Merged
```bash
# Switch back to main
git checkout main

# Pull latest changes
git pull origin main

# Delete local branch
git branch -d feature/your-feature-name
```

## 💡 Commit Message Format

```
<type>: <subject>

<body>

<footer>
```

### Types:
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, etc)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding tests
- **chore**: Maintenance tasks

### Examples:
```bash
git commit -m "feat: add PDF export functionality"
git commit -m "fix: resolve canvas zoom issue on Safari"
git commit -m "docs: update API documentation"
git commit -m "perf: lazy load heavy components"
```

## 🛡️ Safety Commands

```bash
# Check which branch you're on
git branch

# See uncommitted changes
git status

# See commit history
git log --oneline -10

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Stash changes temporarily
git stash
git stash pop

# See remote branches
git branch -r
```

## 🚫 What NOT to Do

```bash
# DON'T do this
git push origin main  # ❌ NEVER!

# DON'T force push to main
git push -f origin main  # ❌ ABSOLUTELY NEVER!

# DON'T merge without testing
git merge feature/untested  # ❌ TEST FIRST!
```

## 📦 Backup Location

Your project is backed up at: `~/NeoBIM_backup`

To update backup:
```bash
cd ~/NeoBIM_backup
git pull origin main
```

## 🔥 Emergency Recovery

If something goes wrong:
```bash
# Reset to backup
cp -r ~/NeoBIM_backup ~/NeoBIM_recovery

# Or reset to last commit
git reset --hard HEAD

# Or reset to specific commit
git reset --hard abc123
```

Remember: **When in doubt, create a branch!** 🌿