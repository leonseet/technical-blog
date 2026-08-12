# Set to a CUDA image (e.g. nvidia/cuda:12.9.1-cudnn-runtime-ubuntu22.04)
# when your repo's tests need a GPU.
ARG BASE_IMAGE=ubuntu:22.04
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && rm -rf /var/lib/apt/lists/*

# System dependencies
RUN apt-get update && apt-get install -y \
  git \
  git-lfs \
  jq \
  gawk \
  nodejs \
  build-essential \
  libgl1 \
  libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH

ARG GLAB_VERSION=1.108.0
RUN curl -fsSL \
  "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${TARGETARCH}.deb" \
  -o /tmp/glab.deb \
  && apt-get install -y /tmp/glab.deb \
  && rm /tmp/glab.deb

ARG GH_VERSION=2.96.0
RUN curl -fsSL \
  "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.deb" \
  -o /tmp/gh.deb \
  && apt-get install -y /tmp/gh.deb \
  && rm /tmp/gh.deb

RUN corepack enable

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Create the "agent" user/group
RUN groupadd -o -g $AGENT_GID agent \
  && useradd --no-log-init -o -u $AGENT_UID -g $AGENT_GID -m -d /home/agent -s /bin/bash agent
USER ${AGENT_UID}:${AGENT_GID}

RUN corepack prepare pnpm@11.6.0 --activate

# Register the LFS smudge/clean filters in the agent's global gitconfig.
RUN git lfs install --skip-repo

# Install uv for repos whose Python is uv-managed
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Keep the project venv off the bind-mounted worktree
ENV UV_PROJECT_ENVIRONMENT=/home/agent/backend-venv

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/agent/.local/bin:$PATH"

# Install Codex CLI
RUN curl -fsSL https://chatgpt.com/codex/install.sh | sh

WORKDIR /home/agent

ENTRYPOINT ["sleep", "infinity"]
