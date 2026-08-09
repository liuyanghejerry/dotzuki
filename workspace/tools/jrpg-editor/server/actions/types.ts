// ───────────────────────────────────────────────────────────────────────────
// AI action framework — shared types.
//
// Every AI feature (refine-character, generate-scene, the chat assistant, …) is
// an `AiAction` in a registry, run behind ONE streaming endpoint (/api/ai/run)
// that emits a STANDARD event vocabulary. This replaces the per-feature
// middlewares that each re-implemented body parsing, key validation and the SSE
// write loop. See tools/jrpg-editor/docs/AI_AGENT_FRAMEWORK.md.
// ───────────────────────────────────────────────────────────────────────────
import type { ProjectContext } from '../context/projectContext'
import type { ProviderProfile, ImageProviderProfile } from '../ai'

/** Standardized streaming event vocabulary shared by every AI action. */
export type AiEventType =
  | 'start'        // { actionId } — run began
  | 'text'         // { delta }    — assistant prose
  | 'reasoning'    // { delta }    — model reasoning
  | 'partial'      // { object }   — streamed structured output
  | 'tool-call'    // { name, args?, path? }
  | 'tool-result'  // { name, ok, summary? }
  | 'proposal'     // { id, target, op?, diff, rationale } — a reviewable edit (M2); op 'delete' removes the target (map-tilemap: whole tilemap set)
  | 'plan'         // { steps: {title, status}[] } — the agent's working plan/todo
  | 'backdrop'     // { map?, rel?, kind } — an ACT image skill rewrote map art (source.png / traced tilemap / title bg)
  | 'progress'     // { label, pct? }
  | 'usage'        // { inputTokens?, outputTokens?, totalTokens? }
  | 'done'         // { result }
  | 'error'        // { message, where? }

export type AiEmit = (type: AiEventType, payload?: unknown) => void

/** Everything an action needs to run + stream. */
export interface ActionContext {
  actionId: string
  /** Action-specific request params from the client. */
  input: Record<string, any>
  profile: ProviderProfile
  apiKey: string
  project: ProjectContext
  /**
   * Image-generation providers + their (transient) keys, sent by the client
   * from the browser's localStorage. Powers the ACT image skills
   * (generate_map_backdrop / edit_map_backdrop / trace_backdrop_to_map / …).
   * Empty when the browser has no configured/credentialed image provider.
   */
  imageProviders?: Array<{ profile: ImageProviderProfile; apiKey: string }>
  /** Emit a standardized streaming event. */
  emit: AiEmit
  /** Aborted when the client disconnects. */
  signal?: AbortSignal
}

export interface AiAction {
  id: string
  /** UI/metadata hint for how the result streams. */
  kind: 'object' | 'agent' | 'chat'
  title: string
  /** Run the action, streaming via ctx.emit; resolve to the final result payload. */
  run(ctx: ActionContext): Promise<unknown>
}
