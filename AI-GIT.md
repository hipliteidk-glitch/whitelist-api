# Letting the AI use git

Short version: **the AI cannot log in, but it can use git once *you* have logged
in.** Authentication is a one-time thing you do; after that git remembers the
credential and the AI's tools inherit it.

## Why the AI does not log in

Logging in means handling a password or token. An AI that "logs in" would have
to be given your token, in a chat window, where it is stored in the transcript
and sent to a model provider. That is precisely how credentials leak.

So the split is:

| | Who does it | How often |
| --- | --- | --- |
| Authenticate to GitHub | **You** | Once per device |
| Commit, pull, push, read history | **The AI** | Any time |

The AI never sees the token. Git holds it; the AI just runs `git push`, and git
supplies the credential underneath.

## 1. Log in once (you)

In Termux:

```bash
pkg install -y gh git
gh auth login
```

Choose **GitHub.com → HTTPS → Yes (authenticate git) → login with a web
browser**, and enter the one-time code it shows. This also configures git's
credential helper, so `git push` stops asking for anything.

No browser on that device? Use a Personal Access Token instead:

```bash
gh auth login --with-token
# paste a token with 'repo' scope, then press Ctrl-D
```

Create the token at **GitHub → Settings → Developer settings → Personal access
tokens**. Give it the minimum scope you need (`repo` for private repos, or
`public_repo`). Paste it into **your terminal only** — never into a chat.

Set who your commits come from:

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

## 2. Give the AI the git tools

```bash
cd ~/zs-app/vendor/ZeroScript-Free
cp config.git.json config.json
ZS_WORKSPACE=~/myrepo bash start-termux.sh -b
```

`ZS_WORKSPACE` must be the repository you want it working in.

## 3. Check it worked

Ask the AI to run `git_auth_check`. You want:

```
authenticated: git can reach origin
```

If it says *NOT authenticated (or no origin)*, step 1 has not been completed on
this device, or the folder has no `origin` remote.

## The tools

| Tool | Does |
| --- | --- |
| `git_status` | Changed files and current branch |
| `git_log` | Recent commits |
| `git_diff` | Unstaged changes (`staged=--staged` for staged) |
| `git_show` | One commit with its diff |
| `git_branch` | Local branches |
| `git_add` | Stage a file or folder |
| `git_commit` | Commit staged changes |
| `git_pull` | Fetch and fast-forward |
| `git_push` | **Publish to the remote** |
| `git_auth_check` | Whether git can reach `origin` (never prints the token) |

## Safety

Deliberately **absent**: `push --force`, `reset --hard`, `clean`, `rebase`, and
anything that prints remote URLs or credentials (a remote URL can embed a
token).

Every command is an argv list run **without a shell**, so an argument cannot
start a second command — verified: a commit message of
`x; touch PWNED` created no file.

`git_push` is the only tool that changes anything outside your machine. If you
want the AI to commit locally but never publish, delete that one entry from
`config.json`.

Remember the AI decides when to call these. Commits are easy to undo; pushes to
a shared branch are not. Consider working on a scratch branch.

## Verified behaviour

Tested end-to-end against real repositories: the AI staged a file, committed it,
read the log and diff, and pushed to a remote successfully. `git_auth_check`
reports correctly both with a working remote and with none — an earlier version
used `git ls-remote --exit-code`, which returns 2 for an *empty* remote and so
wrongly reported an auth failure on a brand-new repo.
