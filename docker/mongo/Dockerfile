# MongoDB for Pomocnik (LibreChat). The chart runs it as UID 10001 with a read-only root
# filesystem; data in /data/mongo on the app volume. The "dump" component runs dump-loop.sh
# (daily mongodump) from the same image.
FROM mongo:8.0.34 AS runtime
# gosu is only used by docker-entrypoint.sh to drop root privileges; this container never runs
# as root, and the old Go runtime in gosu fails the Trivy gate (CRITICAL, fixable).
RUN rm -f /usr/local/bin/gosu
# The base image sets GLIBC_TUNABLES=glibc.pthread.rseq=0 (lets tcmalloc use rseq). On Linux 6.19+
# (the server runs 7.0) tcmalloc's rseq use crashes, and mongod 8.0 refuses to start with that setting
# ("Linux kernel versions 6.19 and newer has a known incompatibility", SERVER-121912). Leaving rseq
# to glibc only costs tcmalloc its per-CPU caches (slower allocation, irrelevant at this size).
ENV GLIBC_TUNABLES=
COPY --chmod=755 dump-loop.sh /usr/local/bin/dump-loop.sh
