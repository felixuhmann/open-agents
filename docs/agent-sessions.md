# Agent sessions and context

Open Agents treats an **application turn** and a **conversation session** as different things:

- One user message creates one `AgentRun` and one Pi model/tool loop.
- A chat conversation, email thread, or workflow-step thread is the durable session shared by those runs.
- The JavaScript `Agent` instance is disposable execution machinery. Postgres is the source of truth.

This is intentional. Keeping a live `Agent` object in API memory would bind a conversation to one process, lose state on deploys, and make queued workers difficult to scale. Reconstructing a runner per turn is the normal server architecture as long as the complete session state is restored.

## Turn lifecycle

1. The API stores the user-facing message and creates an `AgentRun` pinned to an immutable `AgentVersion`.
2. pg-boss serializes chat/email jobs with a queue key scoped to the conversation or thread, allowing at most one active turn for that key.
3. The worker resumes or creates the conversation's OpenSandbox sandbox.
4. The worker loads the latest successful `AgentRun.piContext`. For conversations created before this facility, it reconstructs one turn from the legacy text transcript and writes the first native checkpoint after completion.
5. A new Pi `Agent` receives:
   - the run's reconstructed system prompt and published model/tool configuration;
   - the replayable Pi context;
   - fresh tool implementations and host-side MCP connections;
   - a stable provider cache/session id based on the conversation, not the sandbox id.
6. `agent.prompt()` runs one application-level turn, including all internal model calls and tool executions until idle.
7. On success, Open Agents stores the bounded `agent.state.messages` as `AgentRun.piContext`, then marks the run successful and persists the user-facing assistant text.
8. Failed or timed-out runs do not replace the last successful checkpoint.

## What is preserved

| State                                                                      | Scope                 | Persistence                            |
| -------------------------------------------------------------------------- | --------------------- | -------------------------------------- |
| User and assistant display messages                                        | Conversation/thread   | `ChatMessage` / `EmailMessage`         |
| Full replay context: user, assistant, tool-call, and tool-result messages  | Conversation/thread   | Latest successful `AgentRun.piContext` |
| Provider metadata and reasoning signatures required for valid continuation | Conversation/thread   | Inside `piContext`                     |
| Run trace, usage, tool observability, and streamed events                  | Run                   | `RunEvent`                             |
| Filesystem, mounted resources, and persistent shell workspace              | Conversation/thread   | OpenSandbox sandbox                    |
| Agent instructions, model, tools, skills, and policy used by one run       | Run                   | Pinned `AgentVersion`                  |
| Explicit long-term/user memory                                             | User or agent binding | Platform memory tools/storage          |

## What is rebuilt or reset each turn

- The in-process Pi `Agent` object and event subscriptions.
- Streaming buffers, timers, abort controllers, and pending queues.
- Tool implementation objects and third-party MCP connections.
- Provider API keys and other runtime-only credentials.
- The system prompt, tools, skills, model, and sandbox policy are rebuilt from the run's pinned published version.
- Delegated subagents receive a fresh per-invocation thread; they do not silently inherit another subagent's transcript.

The OpenSandbox sandbox is **not** reset between turns unless its lifecycle requires replacement. OpenSandbox pauses idle sandboxes and reaps them on a server-side TTL; a paused sandbox is resumed on the next turn. Conversation state does not depend on the sandbox surviving: the provider cache id and Pi checkpoint are conversation-scoped.

## Context-window policy

The durable Pi checkpoint retains replayable LLM messages rather than flattening them into display text. Before model calls and before checkpoint persistence, Open Agents reserves 40% of the model's advertised context window for:

- the reconstructed system prompt;
- tool definitions;
- the new user turn;
- additional tool results generated during the run;
- the model's output.

The remaining 60% is available to prior conversation history. When history exceeds that budget, Open Agents keeps the newest **complete user turns**. It never separates an assistant tool call from its tool results. The latest turn is kept even if an unusually large result exceeds the target by itself.

Pruned history remains in user-facing message storage and older run checkpoints for audit, but is no longer sent to the model. Searchable cross-session memory is a separate concern and should use explicit memory services/tools rather than silently replaying every conversation forever.

## Why this matches common agent systems

The relevant convention is durable session state, not object identity:

- [Pi agent core](https://github.com/badlogic/pi-mono/blob/main/packages/agent/README.md) defines `Agent` as stateful while alive, allows `initialState.messages`, and exposes `transformContext` specifically for pruning or compaction. Open Agents persists/restores that state around each disposable runner.
- [Pi's coding-agent SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) wraps the same core with `AgentSession` and `SessionManager` for message history and compaction. Open Agents supplies the equivalent server-side lifecycle with Postgres and pg-boss instead of Pi's local JSONL session files.
- [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents/running-agents) defines one SDK run as one application-level turn and recommends a durable session, conversation id, previous response id, or replay-ready history for the next run.
- [LangGraph](https://docs.langchain.com/oss/javascript/langgraph/persistence) invokes work against a thread id and restores thread-scoped checkpoints; the graph runner itself need not stay alive.
- [Google ADK](https://google.github.io/adk-docs/sessions/) separates the current conversation `Session` and its event/state history from cross-session `Memory`.
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/sessions) persists prompts, tool calls, tool results, and responses, then resumes by session id when a process or host changes.
- [Vercel AI SDK](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) reloads stored messages for each request and recommends preserving tool-bearing message structures rather than only flattened text.

Therefore, recreating a runner is canonical for a distributed service. Recreating it with only flattened text is not; `piContext` closes that gap.
