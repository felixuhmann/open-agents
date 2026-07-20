FROM docker.io/opensandbox/egress:v1.1.4@sha256:973130e01bf76e8e686e2853ebf47b21741bc8781919bb4a7cf60af09a3c6e8a

USER root
RUN mkdir -p /var/egress/rules
COPY opensandbox/deny.always /var/egress/rules/deny.always
RUN chmod 0444 /var/egress/rules/deny.always
