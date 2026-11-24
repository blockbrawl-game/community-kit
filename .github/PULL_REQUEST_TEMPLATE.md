## What is this?
<!-- New mode, change to an existing mode, or fix to the dev kit/docs. One mode per PR. Kit changes: add a CHANGELOG.md entry. -->

## Mode checklist (new or changed modes)
- [ ] `node devkit/cli.js check <mode-id>` prints `READY TO SUBMIT`
- [ ] `version` in `mode.json` is bumped for any change to a published mode
- [ ] All randomness comes from `ctx.rng`; no network, workers, `eval` or typed arrays
- [ ] The store listing is filled in (`tagline`, `description`, `tags`, `orientation`; see `docs/listing.md`)
- [ ] Hidden information (hands, fog) never appears in steps sent to other players
- [ ] Reconnect works: `sync()` rebuilds the full view for a late joiner
- [ ] I wrote this code or have the right to contribute it under this repository's license

## Notes for the reviewer
<!-- Anything unusual: tick rate, state size, why a limit is close. -->
