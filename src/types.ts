// Normalised data model shared by the fetch script and the app.
// The HubSpot API (v3 automation / v4 flows) is mapped into this schema so the
// UI never has to know about HubSpot's raw payload shapes.

export type StepKind =
  | 'trigger' // enrollment / trigger criteria
  | 'branch' // if/then or list branch
  | 'action' // generic action (send email, create task, ...)
  | 'setproperty' // writes a CRM property
  | 'delay' // time delay / delay-until
  | 'goto' // jump to another step
  | 'end' // terminal / suppression

export interface WorkflowStep {
  id: string
  kind: StepKind
  /** Raw HubSpot action/type identifier, kept for reference. */
  actionType?: string
  title: string
  detail?: string
  /** Property names this step reads (filters/criteria). */
  reads: string[]
  /** Property names this step writes. */
  writes: string[]
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  /** e.g. "Yes" / "No" for branches. */
  label?: string
}

export interface PropertyUsage {
  /** Internal HubSpot property name, e.g. "lifecyclestage". */
  name: string
  /** Human label if known. */
  label?: string
  /** CRM object the property belongs to, e.g. "contact". */
  objectType?: string
  reads: number
  writes: number
  /** Step ids within this workflow that reference the property. */
  steps: string[]
}

export interface Workflow {
  id: string
  name: string
  /** HubSpot workflow/flow type. */
  type: string
  /** CRM object the workflow acts on: contact / company / deal / ticket. */
  objectType: string
  enabled: boolean
  updatedAt?: string
  steps: WorkflowStep[]
  edges: WorkflowEdge[]
  properties: PropertyUsage[]
}

export interface WorkflowDataset {
  /** ISO timestamp of when the data was produced. */
  generatedAt: string
  /** "sample" or "live". */
  source: string
  workflows: Workflow[]
}

// ---- Derived / cross-workflow aggregates computed in the browser ----

export interface PropertyAcrossWorkflows {
  name: string
  label?: string
  objectType?: string
  totalReads: number
  totalWrites: number
  /** Workflow ids that touch this property. */
  workflowIds: string[]
}
