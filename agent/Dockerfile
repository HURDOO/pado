FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git bash libsecret-1-0 iptables
# The official installer verifies its release payload against the SHA-512 manifest.
RUN curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh && bash /tmp/agy-install.sh --dir /usr/local/bin
RUN mkdir -p /home/node/.gemini /home/node/.cache /workspace /bridge && chown -R node:node /home/node/.gemini /home/node/.cache /workspace /bridge
COPY --chown=node:node --chmod=0444 agent/present.mjs /opt/pado/present.mjs
COPY --chown=node:node --chmod=0444 agent/command-wait.mjs /opt/pado/command-wait.mjs
COPY --chown=node:node --chmod=0444 agent/tui-hooks.mjs /opt/pado/tui-hooks.mjs
COPY --chown=node:node --chmod=0444 agent/subagent-observer.mjs /opt/pado/subagent-observer.mjs
COPY --chown=node:node --chmod=0444 agent/subagent-output.mjs /opt/pado/subagent-output.mjs
COPY --chown=node:node --chmod=0444 agent/tui-boot.mjs agent/tui-settings.json agent/tui-hooks.json /opt/pado/
COPY --chown=root:root --chmod=0444 agent/network-gate.mjs agent/network-policy.sh /opt/pado/
COPY --chown=root:root --chmod=0444 agent/public-policy.mjs agent/public-settings.json /opt/pado/
COPY --chown=node:node --chmod=0444 server/agent-instructions.ts /opt/pado/instructions.mjs
RUN chmod 0755 /opt/pado
USER node
WORKDIR /workspace
CMD ["agy"]
