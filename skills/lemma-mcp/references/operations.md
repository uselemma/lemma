# Operation examples

Each block names an operation and gives a valid input for it as registered. Send
`input` as the tool arguments (MCP) or as the request (REST). Replace the
placeholder ids and the example window. Read only the section you need. The live
tool schemas stay authoritative for every optional field, and
`lemma://tool-selection-guide` states each operation's effects and retry rule.

Windows are half-open: `start_inclusive` is in the window and `end_exclusive`
is not.

## Issues

Find a set, read known ids, then change one thing.

### `list_issues`

Discover the matching set when ids are not known. Follow `sections.issues.next_cursor` as `cursor` and keep the filters.

```json
{
  "operation_id": "list_issues",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "response_version": 2,
    "status": "open",
    "agent_name": "support",
    "query": "refund",
    "limit": 20
  }
}
```

### `read_issues`

Read known ids with the projections you need. Follow each issue's `next_page` for older evidence.

```json
{
  "operation_id": "read_issues",
  "input": {
    "issue_ids": [
      "22222222-2222-4222-8222-222222222222"
    ],
    "project_id": "11111111-1111-4111-8111-111111111111",
    "include": [
      "state",
      "evidence",
      "fixes"
    ]
  }
}
```

### `transition_issues`

Dismiss, resolve, reopen, or start review. This example resolves with a deployment reference; a dismissal needs `dismissal_reason` and `dismissal_detail` instead.

```json
{
  "operation_id": "transition_issues",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "idempotency_key": "resolve-refund-fix",
    "action": "resolve",
    "items": [
      {
        "issue_id": "22222222-2222-4222-8222-222222222222",
        "resolution_evidence": {
          "kind": "deployment_reference",
          "explanation": "Refund handler fix is live in the latest release.",
          "reference": "https://github.com/acme/support-agent/pull/412"
        }
      }
    ]
  }
}
```

### `update_issue_metadata`

Assign, pin, tag, or record a fix reference. Saving a pull request never resolves the issue.

```json
{
  "operation_id": "update_issue_metadata",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "idempotency_key": "attach-refund-fix-pr",
    "items": [
      {
        "issue_id": "22222222-2222-4222-8222-222222222222",
        "pinned": true,
        "fix_references": [
          {
            "url": "https://github.com/acme/support-agent/pull/412"
          }
        ]
      }
    ]
  }
}
```

## Tickets and project capabilities

Check what the credential may do and what is usable before promising an external write.

### `get_project_capabilities`

Request only the provider sections you need. Require both `allowed` and `available`.

```json
{
  "operation_id": "get_project_capabilities",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "include": [
      "readiness",
      "linear"
    ]
  }
}
```

### `preview_linear_ticket`

Resolve one exact ticket the user named. It never searches or changes Linear.

```json
{
  "operation_id": "preview_linear_ticket",
  "input": {
    "issue_id": "22222222-2222-4222-8222-222222222222",
    "ticket_reference": "ENG-123"
  }
}
```

### `link_linear_ticket`

Link exactly the previewed ticket from its fresh `preview_token`.

```json
{
  "operation_id": "link_linear_ticket",
  "input": {
    "issue_id": "22222222-2222-4222-8222-222222222222",
    "preview_token": "token-from-preview"
  }
}
```

### `create_linear_ticket`

Create and link one ticket, only when the user asked for a new one.

```json
{
  "operation_id": "create_linear_ticket",
  "input": {
    "issue_id": "22222222-2222-4222-8222-222222222222",
    "idempotency_key": "create-refund-ticket"
  }
}
```

## Traces

Read the missing evidence in bounded pieces.

### `query_traces`

Find traces by structure, initial request text, or span content over a half-open window.

```json
{
  "operation_id": "query_traces",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "match": {
      "kind": "span_content",
      "query": "output:timeout"
    },
    "start_inclusive": "2026-11-01T00:00:00.000Z",
    "end_exclusive": "2026-11-08T00:00:00.000Z",
    "filters": {
      "has_error": true
    },
    "sort": "relevance",
    "include_total": true,
    "limit": 20
  }
}
```

### `get_trace`

Read one trace in sections. Select `span_fields` only when you need payloads.

```json
{
  "operation_id": "get_trace",
  "input": {
    "trace_id": "44444444-4444-4444-8444-444444444444",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "response_version": "sections",
    "include": [
      "summary",
      "spans",
      "issues"
    ],
    "span_fields": [
      "attributes"
    ]
  }
}
```

### `get_trace_thread`

Move through a conversation. Use `scope: "neighbors"` for adjacent turns.

```json
{
  "operation_id": "get_trace_thread",
  "input": {
    "trace_id": "44444444-4444-4444-8444-444444444444",
    "project_id": "11111111-1111-4111-8111-111111111111",
    "response_version": "page",
    "scope": "all"
  }
}
```

## Analytics

Request one view, not every panel.

### `get_project_analytics`

A windowed view with a tagged result. Narrow the window if the result is too large.

```json
{
  "operation_id": "get_project_analytics",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "view": "window",
    "response_version": "tagged",
    "start_inclusive": "2026-11-01T00:00:00.000Z",
    "end_exclusive": "2026-11-08T00:00:00.000Z",
    "granularity": "day"
  }
}
```

## Monitors

A monitor judgment is separate from an issue's lifecycle.

### `list_monitors`

Discover bounded monitors; a summary needs a window.

```json
{
  "operation_id": "list_monitors",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "agent_name": "support",
    "response_version": "page",
    "include_summary": true,
    "start_inclusive": "2026-11-01T00:00:00.000Z",
    "end_exclusive": "2026-11-08T00:00:00.000Z"
  }
}
```

### `get_monitor`

Investigate one monitor. Include only the sections the question needs.

```json
{
  "operation_id": "get_monitor",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "monitor_id": "33333333-3333-4333-8333-333333333333",
    "start_inclusive": "2026-11-01T00:00:00.000Z",
    "end_exclusive": "2026-11-08T00:00:00.000Z",
    "include": [
      "summary",
      "traces",
      "feedback"
    ]
  }
}
```

### `correct_monitor_judgment`

Change whether a trace fits one monitor. It does not dismiss an issue or recalibrate the monitor.

```json
{
  "operation_id": "correct_monitor_judgment",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "monitor_id": "33333333-3333-4333-8333-333333333333",
    "action": "record",
    "idempotency_key": "correct-refund-trace",
    "trace_id": "44444444-4444-4444-8444-444444444444",
    "verdict": "exclude",
    "reason": "The agent was not handling a refund here."
  }
}
```

### `decide_monitor_suggestion`

Accept or dismiss one pending phrasing suggestion.

```json
{
  "operation_id": "decide_monitor_suggestion",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "monitor_id": "33333333-3333-4333-8333-333333333333",
    "suggestion_id": "55555555-5555-4555-8555-555555555555",
    "decision": "accept",
    "idempotency_key": "accept-refund-suggestion"
  }
}
```

## Artifacts

Read stored text in lossless chunks.

### `read_project_artifact`

Keep the selected fields fixed and send only unfinished field cursors on continuation.

```json
{
  "operation_id": "read_project_artifact",
  "input": {
    "project_id": "11111111-1111-4111-8111-111111111111",
    "selector": {
      "kind": "agent_understanding",
      "agent_name": "support",
      "version": "latest"
    },
    "fields": [
      "knowledge_md"
    ]
  }
}
```
