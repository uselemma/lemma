"""Shared ingest helpers for scripted and framework tracing tests."""

from __future__ import annotations

import json

PROJECT_ID = "10000000-0000-0000-0000-000000000001"


def make_transport(calls):
    def transport(url, headers, body):
        calls.append(
            {
                "url": url,
                "headers": headers,
                "body": json.loads(body.decode()),
            }
        )
        return 201, "{}"

    return transport
