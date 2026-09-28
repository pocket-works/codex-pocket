# Security policy

## What this project is

A paired phone gets everything the Codex app-server can do on the Mac: running
commands, reading and writing files. That is the point of the project, not a
flaw in it. The boundaries are network reachability and the pairing code, and
the README's [Security model](./README.md#security-model) spells out what that
means before you run it.

So the line is:

**Working as designed — please don't report these:**

- A paired phone can run commands or read files on the Mac.
- Someone already on your tailnet, or on your LAN with `bindHost` unset, can
  reach the host's port. Restrict it there, not here.
- The host is reachable from the public internet after you put it there
  yourself (a tunnel, port forwarding). The README says not to do that without
  another layer of authentication.
- Dictation sends audio to OpenAI, reusing the ChatGPT login already in
  `~/.codex/auth.json`.

**Worth reporting:**

- Getting a working device token without completing a pairing — replaying,
  guessing or forging one, or getting the pairing code out of the host.
- Defeating the pairing code's limits: the 10-minute expiry, the 5-attempt
  lockout, or the entropy of the code itself.
- Reaching an admin endpoint without the admin token, or from off-loopback.
- Reading device tokens back out of the host — they are stored hashed and are
  meant to stay unrecoverable.
- Anything in the PWA that lets thread content reach the token or the Codex
  connection: script injection through a message, a tool result, a filename, a
  diff.
- Making the host talk to an app-server, or a backend, other than the one it
  was pointed at.
- Anything that lets an unpaired party reach the Codex connection at all.

## Reporting

Use GitHub's private vulnerability reporting: the **Security** tab of this
repository, then **Report a vulnerability**. It stays private between us until
there is a fix.

Please don't open a public issue for something in the second list above.

This is one person's side project, not a product with an on-call rotation. I
will confirm that I've read your report, and I'd rather tell you honestly that
a fix will take a while than leave you waiting. If a report turns out to be in
the first list, I'll say so and explain why — that exchange is useful too, and
it usually means the README needs to be clearer.
