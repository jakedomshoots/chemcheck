# GitHub Upload Checklist

## ✅ FILES TO UPLOAD (Include in Git)

### Configuration Files
- `package.json` - Dependencies and scripts
- `package-lock.json` - Locked dependency versions
- `vite.config.js` - Build configuration
- `eslint.config.js` - Linting rules
- `postcss.config.js` - PostCSS configuration
- `tailwind.config.js` - Tailwind CSS configuration
- `.env.example` - Template for environment variables

### Source Code
- `index.html` - Entry point
- `src/` - **Entire folder** including:
  - `src/main.jsx`
  - `src/App.jsx`
  - `src/index.css`
  - `src/pages/` - All page components
  - `src/components/` - All UI components
  - `src/api/` - Convex hooks
  - `src/utils/` - Utility functions
  - `src/test/` - Test setup files

### Convex Backend
- `convex/` - **Entire folder** including:
  - `convex/schema.ts`
  - `convex/customers.ts`
  - `convex/serviceLogs.ts`
  - `convex/chemicalUsage.ts`
  - `convex/notes.ts`
  - `convex/auth.config.js`
  - `convex/_generated/` - Auto-generated types

### Documentation
- `README.md` - Project documentation
- `SETUP.md` - Setup instructions
- `DEPLOYMENT.md` - Deployment guide

### Git Configuration
- `.gitignore` - Files to exclude from Git

## ❌ DO NOT UPLOAD (Should be in .gitignore)

### Environment Files
- `.env.local` - Contains your SECRET keys
- `.env` - Local environment variables

### Dependencies
- `node_modules/` - npm packages (too large, auto-installed)

### Build Output
- `dist/` - Production build output
- `.vite/` - Vite cache

### IDE/Editor Files
- `.vscode/` - VSCode settings
- `.idea/` - JetBrains IDE settings
- `*.swp`, `*.swo` - Vim temporary files
- `.DS_Store` - Mac OS files

### Test Output
- `coverage/` - Test coverage reports
- `test_output.txt` - Test result files
- `test_final.txt`
- `test_output_2.txt`

### Logs
- `npm-debug.log*`
- `yarn-debug.log*`
- `yarn-error.log*`

## Quick Git Commands

```bash
# Initialize git (if not already)
git init

# Add all files (respects .gitignore)
git add .

# Commit
git commit -m "Initial commit - Convex migration complete"

# Create GitHub repo and push
# (Replace with your actual GitHub repo URL)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

## Verify Before Pushing

```bash
# See what will be committed
git status

# See what's being ignored
git status --ignored
```

## Important Notes

⚠️ **NEVER commit**:
- `.env.local` (contains secrets!)
- `node_modules/` (too large, auto-installed)
- Personal API keys or passwords

✅ **ALWAYS commit**:
- `.env.example` (template without secrets)
- All source code in `src/`
- All Convex code in `convex/`
- Configuration files
