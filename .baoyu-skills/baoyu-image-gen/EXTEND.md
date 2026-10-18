---
version: 1
default_provider: openai
default_quality: normal
default_image_api_dialect: null
default_model:
  openai: gpt-image-2.5-flare
batch:
  max_workers: 2
  provider_limits:
    openai:
      concurrency: 1
      start_interval_ms: 2000
---
