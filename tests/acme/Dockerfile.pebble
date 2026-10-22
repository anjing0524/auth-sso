FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d AS binaries

ARG TARGETARCH

RUN apk add --no-cache ca-certificates curl \
    && case "${TARGETARCH}" in \
      amd64) \
        pebble_sha="34595d915bbc2fc827affb3f58593034824df57e95353b031c8d5185724485ce"; \
        challtestsrv_sha="a817449d1f05ae58bcb7bf073b4cebe5d31512f859ba4b83951bd825d28d2114" \
        ;; \
      arm64) \
        pebble_sha="0e70f2537353f61cbf06aa54740bf7f7bb5f963ba00e909f23af5f85bc13fd1a"; \
        challtestsrv_sha="99a276aac8ceac121859b799708218e6dc57d7ca1dc1b8b5b586246b3c4160e6" \
        ;; \
      *) \
        echo "Unsupported architecture: ${TARGETARCH}" >&2; \
        exit 1 \
        ;; \
    esac \
    && curl --fail --location --retry 3 \
      --output /tmp/pebble.tar.gz \
      "https://github.com/letsencrypt/pebble/releases/download/v2.8.0/pebble-linux-${TARGETARCH}.tar.gz" \
    && echo "${pebble_sha}  /tmp/pebble.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/pebble.tar.gz -C /usr/local/bin --strip-components=3 \
    && curl --fail --location --retry 3 \
      --output /tmp/challtestsrv.tar.gz \
      "https://github.com/letsencrypt/pebble/releases/download/v2.8.0/pebble-challtestsrv-linux-${TARGETARCH}.tar.gz" \
    && echo "${challtestsrv_sha}  /tmp/challtestsrv.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/challtestsrv.tar.gz -C /usr/local/bin --strip-components=3 \
    && chmod 755 /usr/local/bin/pebble /usr/local/bin/pebble-challtestsrv \
    && rm /tmp/pebble.tar.gz /tmp/challtestsrv.tar.gz

FROM binaries AS pebble

ENTRYPOINT ["/usr/local/bin/pebble"]

FROM binaries AS challtestsrv

ENTRYPOINT ["/usr/local/bin/pebble-challtestsrv"]
