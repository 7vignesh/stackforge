---

## 🔀 Git Workflow for Contributors

### Cloning the Repository

Since this is a **private repository**, all contributors must be added as collaborators first.
Once added, clone directly — no forking needed:

```bash
git clone https://github.com/7vignesh/stackforge.git
cd stackforge
bun install
```

> **Note:** `bun install` will automatically install all workspace dependencies and set up Husky pre-commit hooks.

---

### Branch Strategy

> ⚠️ **Never push directly to `main`.** All changes must go through a feature branch and a Pull Request.

#### Step-by-step workflow for every change:

```bash
# 1. Always start from the latest main
git checkout main
git pull origin main

# 2. Create your feature branch
git checkout -b feat/your-feature-name

# 3. Make your changes and commit
git add .
git commit -m "feat(scope): short description of change"

# 4. Push your branch
git push origin feat/your-feature-name

# 5. Open a Pull Request on GitHub and request a review
```

---

### Branch Naming Convention

| Who | Branch Name |
|---|---|
| Lead (API + Agents) | `feat/api-orchestrator`, `feat/agents-core` |
| Teammate 2 (Frontend) | `feat/web-dashboard`, `feat/web-sse-integration` |
| Teammate 3 (DevOps/Docs) | `feat/devops-ci`, `feat/docs-readme` |

---

### Pull Request Rules

- At least **1 approval** is required before merging into `main`
- All conversations on a PR must be **resolved before merging**
- The lead engineer reviews and merges all PRs

---
