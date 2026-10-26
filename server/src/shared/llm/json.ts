export function extractJson(content: string): unknown {
  // Strip Markdown code fences if the model added them
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const raw = fenced ? fenced[1]! : content
  return JSON.parse(raw)
}
