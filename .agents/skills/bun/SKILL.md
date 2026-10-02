---
name: Bun
description: Use when building, testing, bundling, or managing JavaScript/TypeScript applications. Reach for Bun when you need to run scripts, install packages, test code, or bundle applications faster than Node.js alternatives. Use for server-side applications, CLI tools, full-stack development, and monorepos.
metadata:
    mintlify-proj: bun
    version: "1.0"
---

# Bun Skill

## Product summary

Bun is an all-in-one JavaScript/TypeScript runtime and toolkit that replaces Node.js, npm, Jest, and esbuild. It ships as a single binary and includes four core tools: a fast runtime (`bun run`), package manager (`bun install`), test runner (`bun test`), and bundler (`bun build`). Bun uses JavaScriptCore (Apple's engine) instead of V8, achieving 4x faster startup than Node.js. Key files: `bunfig.toml` (configuration), `bun.lock` (lockfile), `package.json` (standard). Primary docs: https://bun.com/docs

## When to use

- **Running scripts**: Execute `.ts`, `.tsx`, `.js`, `.jsx` files directly with `bun run` or `bun <file>` — no compilation step needed
- **Installing packages**: Replace `npm install` with `bun install` for 25x faster dependency installation
- **Testing**: Use `bun test` for Jest-compatible testing with TypeScript support, snapshots, and watch mode
- **Bundling**: Use `bun build` to bundle TypeScript/JSX for browsers or servers, or create standalone executables
- **Package scripts**: Run `package.json` scripts with `bun run <script>` (28x faster than npm)
- **Monorepos**: Manage workspaces with `bun install --filter` and run scripts across packages
- **Full-stack apps**: Bundle server and client code together with build-time HTML imports
- **CLI tools**: Create standalone executables with `bun build --compile`

## Quick reference

### Core commands

| Command | Purpose |
|---------|---------|
| `bun run <file>` | Execute a TypeScript/JavaScript file |
| `bun run <script>` | Run a package.json script |
| `bun install` | Install all dependencies |
| `bun add <pkg>` | Add a package |
| `bun remove <pkg>` | Remove a package |
| `bun test` | Run tests matching `*.test.ts`, `*.spec.ts` patterns |
| `bun build <entry> --outdir <dir>` | Bundle code for browser/server |
| `bun build <entry> --compile` | Create standalone executable |
| `bunx <pkg>` | Execute a package without installing |

### Configuration file: bunfig.toml

Located at `./bunfig.toml` or `~/.bunfig.toml`. Optional; Bun works zero-config. Key sections:

```toml
[install]
linker = "hoisted"  # or "isolated" for pnpm-like behavior
optional = true
dev = true
peer = true

[test]
root = "."
coverage = false
timeout = 5000

[run]
shell = "system"  # or "bun"
bun = true        # alias node to bun

[serve]
port = 3000
```

### File type support

| Extension | Behavior |
|-----------|----------|
| `.ts`, `.tsx` | Transpiled on-the-fly; JSX supported |
| `.js`, `.jsx` | Executed directly; JSX supported |
| `.json`, `.toml`, `.yaml` | Parsed and inlined at build time |
| `.html` | Assets bundled; can import in code |
| `.css` | Bundled into single output file |

### Package manager flags

```bash
bun install --production      # Skip devDependencies
bun install --frozen-lockfile # Fail if lockfile out of sync
bun install --dry-run         # Preview without installing
bun install --linker isolated # Use isolated (pnpm-like) strategy
bun add <pkg> --save-dev      # Add as devDependency
bun add <pkg> --optional      # Add as optionalDependency
```

### Test runner flags

```bash
bun test --watch              # Watch mode
bun test --concurrent         # Run tests in parallel
bun test --timeout 10000      # Per-test timeout in ms
bun test -t <pattern>         # Filter by test name
bun test --coverage           # Generate coverage report
bun test --update-snapshots   # Update snapshot files
```

### Bundler options

```bash
bun build ./index.ts --outdir ./dist
bun build ./index.ts --target browser  # or "bun" or "node"
bun build ./index.ts --format esm      # or "cjs"
bun build ./index.ts --minify
bun build ./index.ts --sourcemap linked
bun build ./index.ts --watch
bun build ./index.ts --compile         # Create executable
```

## Decision guidance

### When to use `bun run` vs `bun build`

| Scenario | Use |
|----------|-----|
| Running a script during development | `bun run` |
| Executing a one-off TypeScript file | `bun run` |
| Preparing code for production/browser | `bun build` |
| Creating a standalone executable | `bun build --compile` |
| Bundling dependencies together | `bun build` |

### When to use hoisted vs isolated linker

| Scenario | Use |
|----------|-----|
| Existing Node.js project | `hoisted` (default for existing projects) |
| New monorepo/workspace | `isolated` (default for new workspaces) |
| Need strict dependency isolation | `isolated` |
| Want traditional npm behavior | `hoisted` |

### When to use `bun install` vs `bun add`

| Scenario | Use |
|----------|-----|
| Install all dependencies from package.json | `bun install` |
| Add a new package | `bun add <pkg>` |
| Add as dev dependency | `bun add -d <pkg>` |
| Remove a package | `bun remove <pkg>` |
| Update packages | `bun update` |

## Workflow

### 1. Initialize a project
```bash
bun init my-app
# Choose template: Blank, React, or Library
cd my-app
```

### 2. Install dependencies
```bash
bun install
# Creates bun.lock lockfile
```

### 3. Run code during development
```bash
bun run src/index.ts
# Or with watch mode
bun --watch run src/index.ts
```

### 4. Run package scripts
```bash
# Define in package.json
bun run dev
bun run build
bun run test
```

### 5. Write and run tests
```bash
# Create test files: *.test.ts, *.spec.ts
# Use Jest-like API
import { test, expect } from "bun:test";
test("example", () => {
  expect(1 + 1).toBe(2);
});

# Run tests
bun test
bun test --watch
bun test --coverage
```

### 6. Bundle for production
```bash
# For browser
bun build ./src/index.tsx --outdir ./dist --target browser

# For server
bun build ./src/server.ts --outdir ./dist --target bun

# Create executable
bun build ./cli.ts --compile --outfile mycli
```

### 7. Verify before deployment
- Run `bun test` to ensure all tests pass
- Check `bun build` output for errors
- Verify `bun.lock` is committed to version control
- Test bundled output locally

## Common gotchas

- **Shebang in scripts**: Bun respects `#!/usr/bin/env node` shebangs. Use `bun run --bun <script>` to force Bun execution instead.
- **Node.js compatibility**: Not 100% compatible yet. Check [compatibility page](/runtime/nodejs-compat) for unsupported APIs.
- **Lifecycle scripts**: Bun doesn't run `postinstall` scripts for security. Add packages to `trustedDependencies` in `package.json` to allow them.
- **Auto-install disabled in CI**: Set `install.auto = "disable"` in `bunfig.toml` for CI environments to prevent unexpected installs.
- **Lockfile format**: Bun v1.2+ uses text-based `bun.lock` by default (not binary `bun.lockb`). Commit to version control.
- **TypeScript types**: Add `@types/bun` as dev dependency and configure `tsconfig.json` with `"lib": ["ESNext"]` for full type support.
- **Module resolution**: Bun supports both ESM and CommonJS. Prefer ESM for new projects; CommonJS still works.
- **Environment variables**: Bun auto-loads `.env`, `.env.local`, `.env.[NODE_ENV]`. Disable with `env = false` in `bunfig.toml`.
- **Bundler not a type checker**: `bun build` doesn't check types. Use `tsc --noEmit` separately for type checking.
- **Test discovery**: Only files matching `*.test.ts`, `*_test.ts`, `*.spec.ts`, `*_spec.ts` are discovered. Adjust with `pathIgnorePatterns` in `bunfig.toml`.

## Verification checklist

Before submitting work with Bun:

- [ ] All tests pass: `bun test`
- [ ] No TypeScript errors: `tsc --noEmit` (if using TypeScript)
- [ ] Build succeeds: `bun build` completes without errors
- [ ] `bun.lock` is committed to version control (for reproducible installs)
- [ ] `bunfig.toml` is configured for your use case (if needed)
- [ ] Package scripts in `package.json` are correct
- [ ] No deprecated Node.js APIs used (check compatibility page)
- [ ] Environment variables are properly configured
- [ ] Bundled output runs correctly: `node dist/index.js` or equivalent
- [ ] No console errors in watch mode: `bun --watch run src/index.ts`

## Resources

- **Comprehensive navigation**: https://bun.com/docs/llms.txt — Full page-by-page listing for agent navigation
- **Runtime documentation**: https://bun.com/docs/runtime — Core runtime APIs, file I/O, networking, HTTP server
- **Package manager**: https://bun.com/docs/pm/cli/install — Full install command reference and configuration
- **Bundler**: https://bun.com/docs/bundler — Bundling options, plugins, code splitting, executables

---

> For additional documentation and navigation, see: https://bun.com/docs/llms.txt