import type { Dataset, Experiment, Project, Reference, Tag, Task } from '@/domain/types';
import { emptyDataset } from '@/domain/types';

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;
const NOW = 1_700_000_000_000;

export const base = (isDemo = false) => ({ id: id('base'), createdAt: NOW, updatedAt: NOW, deletedAt: null, isDemo });

export function makeProject(patch: Partial<Project> = {}): Project {
  return { ...base(), id: id('p'), name: '项目', question: '', goal: '', status: 'active', startDate: null, endDate: null, favorite: false, ...patch };
}

export function makeTask(patch: Partial<Task> = {}): Task {
  return {
    ...base(),
    id: id('t'),
    title: '任务',
    description: '',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    projectId: null,
    sourceExperimentId: null,
    referenceId: null,
    completedAt: null,
    recurrence: 'none',
    ...patch,
  };
}

export function makeExperiment(patch: Partial<Experiment> = {}): Experiment {
  return {
    ...base(),
    id: id('e'),
    title: '实验',
    experimentDate: '2026-10-23',
    projectId: null,
    status: 'draft',
    purpose: '',
    hypothesis: '',
    dataSources: [],
    method: '',
    results: '',
    observations: '',
    conclusion: '',
    nextStep: '',
    repoUrl: '',
    commit: '',
    sourceExperimentId: null,
    ...patch,
  };
}

export function makeReference(patch: Partial<Reference> = {}): Reference {
  return {
    ...base(),
    id: id('r'),
    title: '文献',
    authors: '',
    year: null,
    venue: '',
    doi: '',
    url: '',
    readingStatus: 'unread',
    favorite: false,
    noteQuestion: '',
    noteMethod: '',
    noteFindings: '',
    noteLimits: '',
    noteRelevance: '',
    ...patch,
  };
}

export function makeTag(patch: Partial<Tag> = {}): Tag {
  return { ...base(), id: id('tag'), name: '标签', ...patch };
}

export const dataset = (patch: Partial<Dataset> = {}): Dataset => ({ ...emptyDataset(), ...patch });
