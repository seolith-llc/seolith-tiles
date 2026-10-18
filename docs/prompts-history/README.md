# Prompts History Archive (`docs/prompts-history`)

## Directory Structure & Monthly Consolidation Policy

All user requests and assistant responses are automatically logged and organized into a hierarchical `YYYY/MM/` folder structure:

```text
docs/
└── prompts-history/
    ├── README.md
    └── 2026/
        └── 10/
            ├── 2026-10-17_18-16-19_step001.md
            └── ...
```

### Rules
1. **Per-Turn Timestamped Logging**: Every user request and assistant response is saved in `docs/prompts-history/YYYY/MM/YYYY-MM-DD_HH-mm-ss_<step_or_topic>.md`.
2. **Monthly Consolidation**: At the start of each new month (or via `npm run consolidate-prompts`), all individual timestamped markdown files from the completed month `YYYY/MM/` are consolidated into `docs/prompts-history/YYYY/MM/YYYY-MM-consolidated.md` while keeping the hierarchical `YYYY/MM` structure intact.
