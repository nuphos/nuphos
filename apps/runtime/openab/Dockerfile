# The openab base for the runtime image (../image/Dockerfile), which takes only
# /usr/local/bin/openab from it.
#
# The Rust image is pinned, so a toolchain or glibc upgrade only lands here on
# purpose. Get a new digest with:
#   docker pull rust:1-bookworm && docker inspect rust:1-bookworm --format '{{index .RepoDigests 0}}'
FROM rust:1-bookworm@sha256:5e2214abe154fe26e39f64488952e5c991eeed1d6d6da7cc8381ae83927f0cfc AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY src/ src/
RUN cargo build --release --locked --features unified

FROM scratch
COPY --from=build /build/target/release/openab /usr/local/bin/openab
