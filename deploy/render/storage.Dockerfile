FROM rustfs/rustfs:1.0.0
# Persistent disks may start root-owned; the data service initializes its disk.
USER root
ENTRYPOINT []
