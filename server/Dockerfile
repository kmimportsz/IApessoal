FROM python:3.12-slim
RUN useradd --uid 10001 --create-home ipe && mkdir -p /data && chown ipe:ipe /data
WORKDIR /app
COPY main.py .
USER ipe
ENV IPE_BIND=0.0.0.0 IPE_DB=/data/ipe.sqlite3 PORT=8080
EXPOSE 8080
VOLUME ["/data"]
CMD ["python", "main.py"]
