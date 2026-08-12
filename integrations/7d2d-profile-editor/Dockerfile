FROM alpine/git:2.47.2 AS source
ARG UPSTREAM_COMMIT=270f998adf70f3724afd93ba0e08569e3ba78c95
RUN git clone https://github.com/RussDev7/7D2DProfileEditor.git /source \
 && cd /source && git checkout "$UPSTREAM_COMMIT" && rm -rf .git

FROM php:8.3-cli-alpine
LABEL org.opencontainers.image.title="7 Days to Die TTP Profile Editor"
LABEL org.opencontainers.image.source="https://github.com/RussDev7/7D2DProfileEditor"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.vendor="RussDev7 / DannyRuss"
WORKDIR /app
COPY --from=source /source /app
USER www-data
EXPOSE 8000
CMD ["php", "-S", "0.0.0.0:8000", "-t", "/app"]
