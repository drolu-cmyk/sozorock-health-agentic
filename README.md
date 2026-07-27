# SozoRock Health Agentic Infrastructure

Production-grade place intelligence and access coordination layer for every county in the United States.

## Purpose

SozoRock Health provides a non-clinical preparation and systems-intelligence layer that sits on top of existing health, public, digital, and workforce systems. It helps residents move from uncertainty to a clear next step while licensed care remains with licensed providers.

This repository contains the agentic infrastructure that powers:

- **Place Intelligence (Explore)** — Brief, Map, Action, and visual views for any U.S. ZIP, city, or county
- **Voice Access** — Natural spoken interface with pauses, clarification, and multilingual support
- **Health Equity Hub formats** — Library, Community, and Home pathways
- **Health Access Day** coordination signals
- **County planning interface** ready for CB-CAP integration and CHA/CHIP workflows

Coverage: all 3,144 county equivalents.

## Architecture Overview

```
frontend/          → Static Explore + Voice interface (S3 / CloudFront ready)
src/agents/        → Agentic orchestration stubs (place analysis, hub matching, routing)
src/data/          → County data contracts and public-source adapters
src/services/      → Place resolution, barrier scoring, action generation
api/               → Lightweight endpoints for agent and frontend consumption
docs/              → Architecture, data contracts, AWS deployment notes
```

## Design Principles

- Strictly non-clinical
- Source-traceable evidence only
- Minimal data collection
- Human judgment remains visible and central
- Portable across environments (local, AWS, other clouds)
- Agent-ready interfaces (machine-readable outputs, clear contracts)

## Quick Start (Local)

```bash
# Serve the frontend
cd frontend
npx serve .

# Or open frontend/index.html directly in a browser
```

## Deployment Notes (AWS)

See `docs/deployment-aws.md` for S3 + CloudFront static hosting, optional API Gateway + Lambda patterns, and environment configuration.

## Status

Core frontend and agent stubs are in place. Data adapters and live public-source connectors are structured for progressive enhancement.

---

SozoRock Health · Non-clinical · Source-traceable · Nationwide
