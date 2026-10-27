import { z } from 'zod';
import { extractJson } from '@/lib/ai';

const text = z.string().trim().min(1).max(30000);
const deconstructSchema = z.object({ motivation: text, methodology: text, baselines: text, limitations: text });
const taskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  daysFromNow: z.number().int().min(0).max(730),
  priority: z.enum(['urgent', 'high', 'medium', 'low']),
});
const phaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  weeks: z.string().max(100),
  tasks: z.array(taskSchema).min(1).max(20),
});
const plannerSchema = z.object({ phases: z.array(phaseSchema).min(1).max(8) }).refine((value) => {
  const titles = value.phases.flatMap((phase) => phase.tasks.map((task) => task.title));
  return new Set(titles).size === titles.length;
}, '任务标题不能重复');

export type DeconstructResult = z.infer<typeof deconstructSchema>;
export type PlannerPhase = z.infer<typeof phaseSchema>;
export function parseDeconstruct(text: string | undefined): DeconstructResult | null {
  const result = deconstructSchema.safeParse(extractJson(text ?? ''));
  return result.success ? result.data : null;
}
export function parsePlanner(text: string | undefined): PlannerPhase[] | null {
  const result = plannerSchema.safeParse(extractJson(text ?? ''));
  return result.success ? result.data.phases : null;
}
