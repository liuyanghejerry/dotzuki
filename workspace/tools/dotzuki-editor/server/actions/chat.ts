// ───────────────────────────────────────────────────────────────────────────
// streamChat — the chat surface on the Vercel AI SDK UI message stream.
//
// Unlike /api/ai/run (our bespoke SSE vocab), this speaks the AI SDK *UI message
// stream* so the client can use @ai-sdk/vue `useChat` directly: assistant text
// and tool-call parts flow through `result.toUIMessageStream()`, and our review
// proposals ride as TRANSIENT custom `data-proposal` parts (captured client-side
// via useChat's onData, where the review tray owns their apply lifecycle).
//
// Reuses the same READ/PROPOSE tool surface + ProjectContext system prompt as the
// assistant action; only the transport/runner differs.
// ───────────────────────────────────────────────────────────────────────────
import type { ServerResponse } from 'http'
import { buildModel, type ProviderProfile, type ImageProviderProfile } from '../ai'
import type { ProjectContext } from '../context/projectContext'
import type { ActionContext } from './types'
import { ChangeSet } from './changeSet'
import { buildReadTools, buildProposeTools, buildScaffoldTools, buildPlanTools, buildMemoryTools, buildActTools, buildSkillTools, buildExecTools } from './tools'
import { readMemories } from './memory'
import { discoverSkills } from './skills'
import { readAssistantSettings } from './assistantSettings'
import { buildAssistantSystem, buildScaffoldSystem, type UiContext } from './assistantSystem'

export interface StreamChatOptions {
  res: ServerResponse
  /** null = creation mode (no project open): scaffold-drafting tools only. */
  project: ProjectContext | null
  profile: ProviderProfile
  apiKey: string
  /** UIMessage[] sent by useChat. */
  uiMessages: any[]
  /** What the user is currently viewing (activity + route), when a project is open. */
  uiContext?: UiContext
  /** Image-generation providers + transient keys (browser localStorage) — powers
   *  the ACT image skills (generate/edit map backdrop, trace to map, …). */
  imageProviders?: Array<{ profile: ImageProviderProfile; apiKey: string }>
  /** Opt-in prompt inspector: stream the exact prompt payload + per-step detail
   *  as transient data-debug-* parts. Off unless the client panel enables it. */
  debug?: boolean
  signal?: AbortSignal
}

export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const { createUIMessageStream, pipeUIMessageStreamToResponse, streamText, stepCountIs, convertToModelMessages } = await import('ai')
  const userText = lastUserText(opts.uiMessages)
  // Assistant memory (global + project) is folded into the system prompt; the
  // agent appends to it via the remember_fact tool.
  const memories = readMemories(opts.project)
  // Assistant behavior settings (Settings → AI assistant behavior): whether
  // user-global ~/.agents/skills/ skills are in scope, and whether the agent
  // gets run_command. Read per turn so a toggle applies immediately.
  const assistant = opts.project ? readAssistantSettings(opts.project) : null
  // Project skills (skills/*/SKILL.md): only name/description go into the
  // system prompt; the agent loads full instructions via the load_skill tool.
  const skills = opts.project ? discoverSkills(opts.project, { includeUserSkills: assistant!.includeUserSkills }) : []
  let system = opts.project
    ? buildAssistantSystem(opts.project, userText, [], opts.uiContext, memories, skills, assistant!.allowCodeExecution)
    : buildScaffoldSystem(opts.uiContext, memories)

  // Optional embeddings RAG: when the provider has an embeddingModel, augment the
  // system with the top-K most relevant project chunks. Off by default (no model).
  if (opts.project && opts.profile.embeddingModel) {
    try {
      const { retrieve } = await import('../retrieval')
      const hits = await retrieve(opts.project, opts.profile, opts.apiKey, userText)
      if (hits.length) system += '\n\nRetrieved project context:\n' + hits.map(h => `# ${h.id}\n${h.text}`).join('\n\n')
    } catch { /* retrieval is best-effort; fall back to the structured context */ }
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // PROPOSE tools emit('proposal', …), update_plan emits('plan', …) and the
      // ACT image skills emit('backdrop', …) → transient data parts the client
      // collects (the review tray / the plan checklist / the map preview).
      const emit: ActionContext['emit'] = (type, payload) => {
        if (type === 'proposal') writer.write({ type: 'data-proposal', data: payload as any, transient: true })
        else if (type === 'plan') writer.write({ type: 'data-plan', data: payload as any, transient: true })
        else if (type === 'backdrop') writer.write({ type: 'data-backdrop', data: payload as any, transient: true })
      }
      const ctx = {
        actionId: 'assistant', input: {}, profile: opts.profile, apiKey: opts.apiKey,
        project: opts.project, imageProviders: opts.imageProviders, emit, signal: opts.signal,
      } as ActionContext

      // Creation mode (no project): only draft_project_scaffold + update_plan —
      // every tool that reads or proposes against a ProjectContext is excluded.
      // remember_fact is registered in both modes (it is the agent's own memory,
      // not project content; with no project it lands in the global file).
      const cs = new ChangeSet()
      // load_skill is registered only when the project actually has skills in
      // scope — no point offering the model a tool whose domain is empty.
      // run_command is registered only when the author enabled code execution
      // in Settings → AI assistant behavior (default OFF).
      const tools = opts.project
        ? {
            ...(await buildReadTools(ctx)), ...(await buildActTools(ctx)),
            ...(await buildProposeTools(ctx, cs)), ...(await buildPlanTools(ctx)), ...(await buildMemoryTools(ctx)),
            ...(skills.length ? await buildSkillTools(ctx, { includeUserSkills: assistant!.includeUserSkills }) : {}),
            ...(assistant!.allowCodeExecution ? await buildExecTools(ctx) : {}),
          }
        : { ...(await buildScaffoldTools(ctx, cs)), ...(await buildPlanTools(ctx)), ...(await buildMemoryTools(ctx)) }
      const model = await buildModel(opts.profile, opts.apiKey)
      const modelMessages = await convertToModelMessages(opts.uiMessages)

      // Anthropic prompt-caching of the large, stable system block (no-op for
      // openai-compatible providers, which use the plain `system` field).
      const cached = opts.profile.kind === 'anthropic'
      // Prompt inspector (opt-in): the exact payload about to go to the model,
      // then one data-debug-step part per model step as it finishes.
      if (opts.debug) {
        writer.write({
          type: 'data-debug-request',
          data: { system, messages: modelMessages, tools: Object.keys(tools), cached } as any,
          transient: true,
        })
      }
      const result = streamText({
        model,
        tools,
        // Higher than a plain Q&A loop: the agent now iterates draft → check_scene
        // → fix → re-check before proposing, which costs a few extra tool steps.
        stopWhen: [stepCountIs(16)],
        abortSignal: opts.signal,
        ...(opts.debug ? {
          onStepFinish: (step: any) => {
            writer.write({
              type: 'data-debug-step',
              data: {
                text: step.text || undefined,
                toolCalls: (step.toolCalls ?? []).map((c: any) => ({ toolName: c.toolName, input: c.input })),
                toolResults: (step.toolResults ?? []).map((r: any) => ({ toolName: r.toolName, output: r.output })),
                finishReason: step.finishReason,
                usage: step.usage,
              } as any,
              transient: true,
            })
          },
        } : {}),
        ...(cached
          ? { messages: [{ role: 'system', content: system, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } } as any, ...modelMessages] }
          : { system, messages: modelMessages }),
      })

      // Surface token usage to the client (useChat onFinish → the cost meter).
      writer.merge(result.toUIMessageStream({
        messageMetadata: ({ part }: any) => part?.type === 'finish' ? { usage: part.totalUsage } : undefined,
      }))
    },
    onError: (err) => (err instanceof Error ? err.message : String(err)),
  })

  pipeUIMessageStreamToResponse({ response: opts.res, stream })
}

/** Latest user message's text (for @mention resolution in the system prompt). */
function lastUserText(uiMessages: any[]): string {
  for (let i = uiMessages.length - 1; i >= 0; i--) {
    const m = uiMessages[i]
    if (m?.role === 'user' && Array.isArray(m.parts)) {
      return m.parts.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join(' ')
    }
  }
  return ''
}
