import crypto from 'crypto';

type TaskState = {
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  error?: string;
};

const TASK_TTL_MS = 10 * 60 * 1000;
const tasks = new Map<string, TaskState>();

const scheduleCleanup = (taskId: string) => {
  setTimeout(() => tasks.delete(taskId), TASK_TTL_MS).unref?.();
};

export const createTask = (initialStatus: TaskState['status'] = 'running') => {
  const id = crypto.randomUUID();
  tasks.set(id, { status: initialStatus });
  scheduleCleanup(id);
  return id;
};

export const updateTask = (taskId: string, updates: Partial<TaskState>) => {
  const current = tasks.get(taskId);
  if (!current) return;
  tasks.set(taskId, { ...current, ...updates });
};

export const getTask = (taskId: string) => tasks.get(taskId);

export const deleteTask = (taskId: string) => {
  tasks.delete(taskId);
};
