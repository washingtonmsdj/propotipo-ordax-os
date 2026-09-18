# OrdaX rescue channel

The rescue channel is deliberately separate from the normal \`main\` update loop.

The Surface host installs \`system/rescue/agent.sh\` into persistent device state at
\`/state/ordax/rescue/agent.sh\` and starts it in a separate session. Once installed,
that copy is outside the replaceable Git checkout and is not stopped by normal
Surface cleanup.

The agent is intentionally narrow. It polls the public \`ordax-rescue\` Git ref and
reads only \`rescue/command.txt\`. It does not accept shell text, URLs, scripts or
arbitrary paths. Version 1 supports only:

- \`noop\`
- \`clear-rejected\`
- \`retry-main\`

Every command carries a monotonic generation and an exact 40-character target SHA.
The agent executes a command only when that target exactly equals the current remote
\`main\` SHA. \`retry-main\` clears the rejected-commit marker and asks the currently
running Surface process to exit; the normal supervisor remains responsible for the
Git checkout and restart. This first version deliberately does not reset Git, reboot,
power off, or execute arbitrary commands.

Command format:

\`\`\`text
ORDAX_RESCUE_COMMAND_V1
generation=1
action=retry-main
target_sha=<40 lowercase hex characters>
\`\`\`

The separate ref gives automation a second read-only control path without placing
GitHub write credentials on the device. Later versions may gain a safe staged-recovery
action only after supervisor heartbeat/locking exists; that must not weaken the current
target binding or introduce remote shell execution.
