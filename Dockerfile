# OnboardOps status page, powered by Kener (https://kener.ing).
# We run the official image and pin its version, so updates only happen when we change this line.
# Find the newest release tag at https://hub.docker.com/r/rajnandan1/kener/tags (or the GitHub releases page).
# If the build says the tag does not exist, change it to one that does. Do not use "latest" in production.
ARG KENER_VERSION=v4.0.16
FROM docker.io/rajnandan1/kener:${KENER_VERSION}
