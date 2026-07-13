# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report them privately through GitHub's private vulnerability reporting:

- Go to the [**Security** tab](https://github.com/jcarterwil/Sailing/security/advisories/new)
  and click **Report a vulnerability**, or
- email **carter@oiventures.com**.

Please include:

- a description of the issue and its impact,
- steps to reproduce (a proof-of-concept if you have one),
- affected URL/route or file, and
- any suggested remediation.

You should get an acknowledgement within a few days. Please give a reasonable
window to investigate and ship a fix before any public disclosure.

## Scope

This app handles authentication and user-uploaded GPS race data on Supabase.
Issues that are especially in scope:

- authentication/session handling and open redirects,
- row-level-security (RLS) gaps or ways to read another user's races/tracks,
- misuse of the service-role (admin) client that bypasses RLS,
- exposure of secrets, or a secret placed in a `NEXT_PUBLIC_` variable.

Thank you for helping keep the project and its users safe.
