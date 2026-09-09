import { createParticipantSchema } from './participants.schemas.js';

const IMPORT_LIMIT = 100;

export type ImportParticipant = {
  line: number;
  name: string;
  email: string;
};

export type ImportIssue = {
  line: number;
  reason: string;
};

type ImportParseResult = {
  participants: ImportParticipant[];
  issues: ImportIssue[];
};

const isHeader = (columns: string[]): boolean => {
  if (columns.length !== 2) {
    return false;
  }

  const [name, email] = columns.map((value) => value.trim().toLowerCase());

  return (name === 'nome' || name === 'name') && email === 'email';
};

const formatIssues = (issues: ImportIssue[]): string =>
  issues.map(({ line, reason }) => `line ${line}: ${reason}`).join('; ');

export const parseParticipantImport = (data: string): ImportParseResult => {
  const participants: ImportParticipant[] = [];
  const issues: ImportIssue[] = [];
  let hasCheckedHeader = false;

  for (const [index, rawLine] of data.split(/\r?\n/).entries()) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const columns = rawLine.includes('\t')
      ? rawLine.split('\t')
      : rawLine.split(';');

    if (!hasCheckedHeader) {
      hasCheckedHeader = true;

      if (isHeader(columns)) {
        continue;
      }
    }

    if (columns.length !== 2) {
      issues.push({
        line: index + 1,
        reason: 'Expected exactly two columns: name and email.',
      });
      continue;
    }

    const parsedParticipant = createParticipantSchema.safeParse({
      name: columns[0],
      email: columns[1],
    });

    if (!parsedParticipant.success) {
      const reason = parsedParticipant.error.issues.some(
        (issue) => issue.path[0] === 'email',
      )
        ? 'Invalid email.'
        : 'Invalid name.';

      issues.push({ line: index + 1, reason });
      continue;
    }

    participants.push({ line: index + 1, ...parsedParticipant.data });
  }

  if (participants.length + issues.length > IMPORT_LIMIT) {
    issues.push({
      line: IMPORT_LIMIT + 1,
      reason: `Import limit of ${IMPORT_LIMIT} participants exceeded.`,
    });
  }

  if (participants.length === 0 && issues.length === 0) {
    issues.push({ line: 1, reason: 'No participants were provided.' });
  }

  return { participants, issues };
};

export const importValidationMessage = (issues: ImportIssue[]): string =>
  `Invalid import data: ${formatIssues(issues)}`;
