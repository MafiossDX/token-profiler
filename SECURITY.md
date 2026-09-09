# Security Policy

## Reporting A Vulnerability

Do not report security vulnerabilities through public GitHub Issues.

Use GitHub private vulnerability reporting if it is enabled for this repository.
If no private reporting channel is available yet, open a minimal public issue
without sensitive details and ask for a private contact path.

Do not include secrets, API keys, raw request payloads, profiler databases, or
debug-capture files in public reports.

## Sensitive Data

`token-profiler` is a local observability tool for LLM / AI agent traffic. It may
observe metadata derived from model API requests, including request timing,
provider-reported token usage, content byte lengths, fingerprints, and local Task
identifiers.

By default, `token-profiler` does not store raw request bodies in the profiler
database. Content matching is based on keyed fingerprints generated with a
machine-local secret.

Local runtime data is stored under:

```text
~/.token-profiler/
```

This directory may contain the profiler database, local fingerprint secret, and
other local runtime data. Do not publish it.

## Debug Capture

`--debug-capture-filter` is an opt-in diagnostic feature. It can write selected
raw chunk text to disk outside the profiler database.

Treat debug-capture output as sensitive. Review it before sharing it, and delete
it when it is no longer needed:

```sh
node bin/token-profiler.ts debug-capture purge --task <task_id>
```

## Supported Versions

Security fixes are currently provided for the latest code on the default branch.
Older versions are not supported unless stated otherwise.

## Scope

Please report issues such as:

- accidental storage or exposure of raw request content
- leakage of API keys, local secrets, database files, or debug captures
- proxy behavior that forwards requests to an unintended destination
- unsafe handling of local files or paths
- vulnerabilities in export endpoints or the local UI

General bugs, feature requests, and documentation issues can use normal GitHub
Issues.
