# Publishing a mode

When `brawl-modes check` prints `READY TO SUBMIT`, submit the mode to the game from your own machine. A person
reviews it; when it is approved it goes live without a game release.

## 1. Get a creator token

Creators are invited for now: ask the BlockBrawl team for a creator token. It looks like `bbm_...`. Treat it like a
password: anyone with it can submit versions of your modes.

Put it in an environment variable, never in your code or a file you commit:

```bash
export BRAWL_MODES_TOKEN=bbm_...
```

(In CI, store it as a secret with that name.)

## 2. Publish

```bash
npx brawl-modes publish my-mode
```

`publish`:

1. runs `brawl-modes check` and stops if it fails, because the server runs the same check;
2. packs the mode's source: every file in `modes/my-mode/` except `dist/`, `node_modules/` and hidden files;
3. uploads it, and prints the submission id.

The first accepted submission of a mode id makes you its owner: nobody else can submit that id.

## 3. Follow it

```bash
npx brawl-modes status sub_0123456789abcdef --wait   # one submission; --wait until its check is done
npx brawl-modes status my-mode                       # that mode's recent submissions
npx brawl-modes status                               # your modes and their live versions
```

| State | Meaning | What you do |
|---|---|---|
| `Checking` | The server is building it and running `check` in an isolated worker | Wait (usually under a minute) |
| `CheckFailed` | `check` failed on the server; the reasons are listed | Fix them (`check` locally shows the same) and publish again; the same version is fine |
| `ReadyForReview` | Passed everything automatic; a person will read and play it | Wait |
| `Approved` | Published; the live version reaches players within a minute | Nothing |
| `Rejected` | The reviewer said no; the note says why | Change the mode, raise `version`, publish again |
| `Superseded` | You published a newer version before this one was reviewed | Nothing |

## What the server does

- It extracts your upload safely: only regular files with the extensions a mode uses, no links, no paths outside the
  mode folder, at most 10 MB compressed and 25 MB extracted, at most 500 files.
- It builds the mode with the same pinned kit and runs `check` in a container with no network. The build that is
  checked must equal, byte for byte, the build that is published, so builds must be reproducible (they are, as long
  as the output depends only on your files).
- A reviewer reads every file of the server and the client and plays the mode, with the checklist in
  [the pull request template](../.github/PULL_REQUEST_TEMPLATE.md): randomness from `ctx.rng`, no hidden
  information in shared steps, `sync()` rebuilds everything, and nothing abusive in the client.
- Approved builds are immutable. An update is a new version, reviewed again; the team can roll a mode back to an
  earlier approved version or switch it off at any time.

## Rules

- Every submission needs a `version` higher than the last approved one. A version that is waiting for review or
  approved cannot be submitted again.
- At most 10 submissions an hour. Run `check` locally until it passes; the server will not find anything else.
- The `id` is yours once claimed. Never change it: a new id is a new mode.

## Options

| Flag or variable | Default | Meaning |
|---|---|---|
| `BRAWL_MODES_TOKEN` | none | Your creator token (required) |
| `BRAWL_MODES_SERVER`, `--server <url>` | `https://api.block-brawl.com` | The game's API, for example a test server |
| `--json` | | One result object on stdout, for scripts and AI assistants |
| `--skip-check` | | Upload without running `check` first (the server still runs it) |
