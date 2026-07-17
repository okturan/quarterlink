# Security Policy

## Supported code

QuarterLink has not published a stable release. Security fixes target the current `main` branch and the deployment at <https://quarterlink.okan.workers.dev/>. Older commits and third-party forks are not maintained.

## Report a vulnerability

Use [GitHub's private vulnerability reporting form](https://github.com/okturan/quarterlink/security/advisories/new). Please do not disclose a suspected vulnerability in a public issue.

Include enough information to reproduce and assess the report safely:

- the affected route, browser flow, or commit;
- the expected and observed behavior;
- minimal reproduction steps or a proof of concept;
- the security impact and any prerequisites; and
- suggested mitigations, if known.

Do not include commercial game files, credentials, session tokens, invitation secrets, personal data, or traffic captured from people who did not consent. Use the bundled Frog Feast fixture and a temporary room whenever possible.

## Security scope

Relevant reports include vulnerabilities in:

- room, session, seat, and single-use invitation authorization;
- WebSocket signaling validation and Durable Object isolation;
- WebRTC input or media handling;
- cross-origin isolation, content security policy, and browser runtime boundaries;
- unintended file, ROM, token, or personal-data transmission; and
- the deployed Worker or checked-in application code.

Third-party emulator/core defects should also be reported upstream when appropriate. Reports about obtaining copyrighted game files, unsupported browser behavior without a security impact, denial of service through high-volume automated traffic, or social engineering are outside this project's security scope.

## Safe research

Test only against rooms and files you control. Do not access another person's session, disrupt the public service, or retain data beyond what is necessary to demonstrate the issue. Good-faith reports that follow this policy are welcome.
