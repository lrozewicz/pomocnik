# MongoDB for Pomocnik (LibreChat). The chart runs it as UID 10001 with a read-only root
# filesystem; data in /data/mongo on the app volume. The "dump" component runs dump-loop.sh
# (daily mongodump) from the same image.
FROM mongo:8.0.34 AS runtime
# gosu is only used by docker-entrypoint.sh to drop root privileges; this container never runs
# as root, and the old Go runtime in gosu fails the Trivy gate (CRITICAL, fixable).
RUN rm -f /usr/local/bin/gosu
COPY --chmod=755 dump-loop.sh /usr/local/bin/dump-loop.sh
