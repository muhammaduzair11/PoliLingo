# Local setup on Windows

From a machine with nothing installed to a running PoliLingo development server.
Around 30 minutes, mostly waiting on downloads.

If you are the second developer joining the project, this is your first page.

---

## 1. Install the tools

Open **PowerShell as Administrator** (right-click the Start button → _Windows PowerShell
(Admin)_) and run:

```powershell
winget install --id Git.Git --exact --accept-source-agreements --accept-package-agreements
winget install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
winget install --id GitHub.cli --exact --accept-source-agreements --accept-package-agreements
winget install --id Microsoft.VisualStudioCode --exact --accept-source-agreements --accept-package-agreements
```

**Close PowerShell and open a new window.** Installers change `PATH`, and only new
windows see the change. Nearly every "command not found" at this stage is this.

Node.js **LTS**, not Current: `package.json` requires `>= 22.13.0`, and LTS is what CI and
Vercel build against.

## 2. Configure Git

```powershell
git config --global user.name "Your Name"
git config --global user.email "12345678+yourusername@users.noreply.github.com"
git config --global init.defaultBranch main
git config --global core.autocrlf false
git config --global core.eol lf
git config --global core.longpaths true
git config --global rerere.enabled true
git config --global pull.rebase true
git config --global credential.helper manager
```

Find your no-reply email at <https://github.com/settings/emails>. Using an address GitHub
does not recognise means your commits are not attributed to you and Vercel may reject the
deployment.

Two of those settings are not the usual Windows advice and are deliberate:

- **`core.autocrlf false`** — this repository stores LF line endings. The common
  `autocrlf true` setting rewrites them to CRLF on checkout, which makes a one-line edit
  appear in review as a whole-file rewrite. `.gitattributes` enforces this at the
  repository level too.
- **`rerere.enabled true`** — remembers how you resolved a merge conflict and reapplies it
  automatically next time. With two people repeatedly conflicting in the same large files,
  this saves real time.

## 3. Sign in to GitHub

```powershell
gh auth login --hostname github.com --git-protocol https --web
```

Choose _Yes_ when asked whether to authenticate Git with your GitHub credentials.

## 4. Clone and run

```powershell
cd D:\Polilingo
git clone https://github.com/polilingo/web.git web
cd web
npm install
npm run dev
```

Open <http://localhost:3000>.

No `.env.local` is needed today — the app currently has **no environment variables** and
runs entirely on static content plus browser state. That changes around week 4; see
[`configuration.md`](configuration.md).

## 5. Check the quality gates run

These four are what CI enforces on every pull request. Run all four before you push, or
you will find out from a failed check instead.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

All four must pass on a clean checkout. If any fails before you have changed anything,
that is a real problem — say so rather than working around it.

---

## The toolchain is not the usual one

If you have worked on React projects before, some of this will look wrong. It is not.

| You might expect       | This project uses                      | Why                                                       |
| ---------------------- | -------------------------------------- | --------------------------------------------------------- |
| ESLint                 | **oxlint**                             | Rust-based, much faster, type-aware via `oxlint-tsgolint` |
| Prettier               | **oxfmt**                              | Same family as oxlint                                     |
| Jest or Vitest         | **`node --test`**                      | Built into Node. No test framework dependency at all      |
| `npm run format:check` | `npm run format` then check `git diff` | oxfmt formats in place                                    |

Do not add ESLint, Prettier, Jest or Vitest. That choice is recorded in ADR-0011 in the
docs repository, along with when it should be revisited.

---

## VS Code

Extensions worth having:

- **Tailwind CSS IntelliSense** — this project uses Tailwind v4 with theme tokens defined
  as CSS custom properties in `app/globals.css`, so autocomplete matters more than usual.
- **oxc** (the official oxlint extension) — shows lint errors inline.
- **EditorConfig for VS Code**.

Workspace settings worth adding to `.vscode/settings.json` (gitignored, personal):

```json
{
  "files.eol": "\n",
  "editor.formatOnSave": false,
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

`formatOnSave` is off on purpose: oxfmt is run through `npm run format`, and a
format-on-save from a different formatter will fight it and produce noisy diffs.

---

## Common problems

**`'npm' is not recognized`** — you did not open a new PowerShell window after installing.

**`npm install` fails on `sharp`** — `sharp` compiles native code for the image pipeline.
It needs the Visual C++ runtime, which this machine already has. If it still fails:
`npm install --include=optional sharp`.

**Every file shows as modified after cloning** — line endings. Check
`git config --global core.autocrlf` returns `false`, then:

```powershell
git rm --cached -r .
git reset --hard
```

**Port 3000 is in use** — `npm run dev -- -p 3001`.

**`npm run build` is slow the first time** — Next.js 16 with Turbopack caches aggressively
after the first run. A cold build of two to three minutes is normal.

---

## Where to go next

1. [`../README.md`](../README.md) — what the app is and how it is laid out
2. [`architecture.md`](architecture.md) — how it works today
3. [`testing.md`](testing.md) — what to test and how
4. `docs/process/sdlc-handbook.md` in the **docs** repository — how the two of you work
   together. Read this before opening a pull request.
