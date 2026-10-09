# Roll back a change

The `v0.1.0-baseline` tag records the first tested public version. Commit working changes before a large refactor so each step has a recovery point.

To undo a committed change while keeping history:

```sh
git log --oneline
git revert <commit-id>
npm ci
npm run package
```

To inspect the baseline without changing your current checkout:

```sh
git worktree add ../loom-baseline v0.1.0-baseline
```

Git tracks application source. Chats, credentials, downloaded papers, and settings live in the user's Loom data directory and are excluded from this repository. Back up that directory separately before a data migration. Linux defaults to `~/.config/Loom`; `STUDIO_DATA_DIR` overrides it.
