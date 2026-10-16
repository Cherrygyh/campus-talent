import { createHash } from 'node:crypto';
import { type Candidate, type Config, norm, validateCandidate } from './talent';

export type RegistrationFields = Pick<
  Candidate,
  'name' | 'className' | 'studentId' | 'phone' | 'email' | 'extra'
>;
export type RegistrationRecord = RegistrationFields & { remoteId: string };
export type RegistrationMapping = {
  remoteId: string;
  candidateId: string;
  baseline: RegistrationFields;
  /** Keep unresolved conflicts visible when the next poll returns identical source data. */
  pendingFields?: string[];
  /** Identical repeated submissions remain attached to the original stable remoteId. */
  duplicateRemoteIds?: string[];
};
export type RegistrationConflict = {
  remoteId: string;
  candidateId?: string;
  kind: 'identity' | 'field';
  fields: string[];
  message: string;
};
export class RegistrationSyncError extends Error {
  constructor(
    message: string,
    public readonly conflicts: RegistrationConflict[] = [],
  ) {
    super(message);
    this.name = 'RegistrationSyncError';
  }
}
export type RegistrationSyncInput = {
  sourceId: string;
  source: string;
  batch: string;
  config: Config;
  records: readonly RegistrationRecord[];
  candidates: readonly Candidate[];
  mappings: readonly RegistrationMapping[];
  now: string;
};
export type RegistrationSyncPlan = {
  additions: Candidate[];
  updates: { before: Candidate; after: Candidate }[];
  /** The complete mapping set, including records absent from this source snapshot. */
  mappings: RegistrationMapping[];
  conflicts: RegistrationConflict[];
  counts: {
    added: number;
    updated: number;
    linked: number;
    unchanged: number;
    skipped: number;
    conflicts: number;
    duplicates?: number;
  };
};

const fields = ['name', 'className', 'studentId', 'phone', 'email'] as const;
const identityFields = ['studentId', 'phone', 'email'] as const;
const own = (object: Record<string, string>, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;

function candidateFrom(
  registration: RegistrationFields,
  input: RegistrationSyncInput,
  id: string,
): Candidate {
  return validateCandidate(
    {
      name: registration.name,
      className: registration.className,
      studentId: registration.studentId,
      phone: registration.phone,
      email: registration.email,
      extra: registration.extra,
      id,
      batch: input.batch,
      direction: '',
      status: '待面试',
      notes: '',
      interviewer: '',
      scores: {},
      source: input.source,
      createdAt: input.now,
      updatedAt: input.now,
    },
    input.config,
  );
}

function normalizedFields(
  value: RegistrationFields,
  input: RegistrationSyncInput,
): RegistrationFields {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RegistrationSyncError('报名记录格式无效');
  for (const key of fields)
    if (typeof value[key] !== 'string')
      throw new RegistrationSyncError(`报名字段 ${key} 必须为文本`);
  const registration: RegistrationFields = {
    name: value.name.trim(),
    className: value.className.trim(),
    studentId: value.studentId.trim().toUpperCase(),
    phone: value.phone.trim(),
    email: value.email.trim(),
    extra: value.extra,
  };
  const checked = candidateFrom(registration, input, 'registration_validation');
  return {
    name: checked.name,
    className: checked.className,
    studentId: checked.studentId,
    phone: checked.phone,
    email: checked.email,
    extra: checked.extra,
  };
}

function registrationId(sourceId: string, batch: string, remoteId: string) {
  return (
    'registration_' +
    createHash('sha256')
      .update(JSON.stringify([sourceId, batch, remoteId]))
      .digest('hex')
      .slice(0, 48)
  );
}

function identityError(
  remoteId: string,
  message: string,
  candidateId?: string,
): RegistrationConflict {
  return { remoteId, candidateId, kind: 'identity', fields: [], message };
}

function registrationFingerprint(record: RegistrationFields) {
  return JSON.stringify([
    ...fields.map((field) => record[field]),
    Object.entries(record.extra).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  ]);
}

function foldIdenticalSubmissions(
  incoming: Map<string, RegistrationRecord>,
  mappings: Map<string, RegistrationMapping>,
) {
  const records = new Map<string, RegistrationRecord>();
  const aliases = new Map<string, Set<string>>();
  const ownedRemoteIds = new Set<string>();
  const ownersByFingerprint = new Map<string, string[]>();
  for (const mapping of mappings.values()) {
    const duplicateIds = mapping.duplicateRemoteIds || [];
    if (
      !Array.isArray(duplicateIds) ||
      duplicateIds.some(
        (id) => typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 500,
      )
    )
      throw new RegistrationSyncError('重复答卷关联格式无效，未应用本轮数据');
    const ids = [mapping.remoteId, ...duplicateIds];
    for (const id of ids) {
      if (ownedRemoteIds.has(id))
        throw new RegistrationSyncError('重复答卷关联重复，未应用本轮数据');
      ownedRemoteIds.add(id);
    }
    aliases.set(mapping.remoteId, new Set(duplicateIds));
    const present = ids.map((id) => incoming.get(id)).filter((record) => !!record);
    const representative = present[0];
    if (
      representative &&
      present.some(
        (record) => registrationFingerprint(record) !== registrationFingerprint(representative),
      )
    )
      throw new RegistrationSyncError('已关联的重复答卷内容有冲突，未应用本轮数据', [
        identityError(
          mapping.remoteId,
          '原答卷与重复答卷的报名内容不同，需要手动核对',
          mapping.candidateId,
        ),
      ]);
    if (representative)
      records.set(mapping.remoteId, { ...representative, remoteId: mapping.remoteId });
    // If all known IDs vanished, an identical later resubmission can still keep the original ID.
    const current = representative || mapping.baseline;
    if (current.studentId) {
      const fingerprint = registrationFingerprint(current);
      ownersByFingerprint.set(fingerprint, [
        ...(ownersByFingerprint.get(fingerprint) || []),
        mapping.remoteId,
      ]);
    }
  }

  const newGroups = new Map<string, RegistrationRecord[]>();
  for (const record of incoming.values()) {
    if (ownedRemoteIds.has(record.remoteId)) continue;
    // Empty identifiers cannot prove that identical names and answers are the same student.
    const fingerprint = record.studentId
      ? registrationFingerprint(record)
      : JSON.stringify(['unidentified', record.remoteId]);
    newGroups.set(fingerprint, [...(newGroups.get(fingerprint) || []), record]);
  }
  for (const [fingerprint, group] of newGroups) {
    const owners = ownersByFingerprint.get(fingerprint) || [];
    if (owners.length > 1)
      throw new RegistrationSyncError('完全相同答卷命中多个已有同步关联，未应用本轮数据', [
        identityError(group[0].remoteId, '已有多份主答卷，无法自动选择关联'),
      ]);
    const primaryId = owners[0] || group.map((record) => record.remoteId).sort()[0];
    if (!records.has(primaryId)) records.set(primaryId, { ...group[0], remoteId: primaryId });
    const duplicates = aliases.get(primaryId) || new Set<string>();
    for (const record of group) if (record.remoteId !== primaryId) duplicates.add(record.remoteId);
    aliases.set(primaryId, duplicates);
  }
  return {
    records,
    aliases: new Map([...aliases].map(([id, ids]) => [id, [...ids].sort()])),
    duplicates: incoming.size - records.size,
  };
}

/**
 * Plan a complete source snapshot without reading storage, doing I/O or mutating its inputs.
 * Identity errors reject the entire plan. Field conflicts preserve local work and can coexist
 * with safe changes to other fields. Missing source records never delete candidates or mappings.
 */
export function planRegistrationSync(input: RegistrationSyncInput): RegistrationSyncPlan {
  if (!input.sourceId?.trim() || input.sourceId.length > 500)
    throw new RegistrationSyncError('同步来源编号无效');
  if (!Number.isFinite(Date.parse(input.now))) throw new RegistrationSyncError('同步时间无效');
  if (!input.config.batches.some((batch) => batch.id === input.batch))
    throw new RegistrationSyncError('同步报名批次不存在');
  if (input.records.length > 3000) throw new RegistrationSyncError('每次最多同步 3000 条报名');
  const existing = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  if (existing.size !== input.candidates.length)
    throw new RegistrationSyncError('本地候选人编号重复，无法同步');

  const incoming = new Map<string, RegistrationRecord>();
  for (const record of input.records) {
    if (
      !record ||
      typeof record.remoteId !== 'string' ||
      !record.remoteId.trim() ||
      record.remoteId !== record.remoteId.trim() ||
      record.remoteId.length > 500
    )
      throw new RegistrationSyncError('远端答卷缺少稳定编号，无法同步');
    if (incoming.has(record.remoteId))
      throw new RegistrationSyncError('同一次同步出现重复远端答卷编号，未应用本轮数据');
    incoming.set(record.remoteId, {
      ...normalizedFields(record, input),
      remoteId: record.remoteId,
    });
  }

  const mappings = new Map<string, RegistrationMapping>();
  const mappedCandidates = new Map<string, string>();
  for (const mapping of input.mappings) {
    if (
      !mapping.remoteId ||
      mappings.has(mapping.remoteId) ||
      mappedCandidates.has(mapping.candidateId)
    )
      throw new RegistrationSyncError('已有同步关联重复，未应用本轮数据');
    mappings.set(mapping.remoteId, {
      ...structuredClone(mapping),
      baseline: normalizedFields(mapping.baseline, input),
    });
    mappedCandidates.set(mapping.candidateId, mapping.remoteId);
  }
  const { records, aliases, duplicates } = foldIdenticalSubmissions(incoming, mappings);

  // Resolve every identity before merging any row. Do not let source row ordering decide a match.
  const targets = new Map<string, Candidate | null>();
  const claims = new Map(mappedCandidates);
  const identityConflicts: RegistrationConflict[] = [];
  const incomingIdentity = new Map<string, string>();
  for (const record of records.values()) {
    for (const key of identityFields) {
      const value = norm(record[key]);
      if (!value) continue;
      const identity = JSON.stringify([key, value]);
      const otherRemoteId = incomingIdentity.get(identity);
      if (otherRemoteId && otherRemoteId !== record.remoteId)
        identityConflicts.push(identityError(record.remoteId, '多份答卷使用相同学号、电话或邮箱'));
      incomingIdentity.set(identity, record.remoteId);
    }
    const mapped = mappings.get(record.remoteId);
    const matches = input.candidates.filter(
      (candidate) =>
        candidate.batch === input.batch &&
        identityFields.some(
          (key) => norm(record[key]) && norm(record[key]) === norm(candidate[key]),
        ),
    );
    let target: Candidate | null = null;
    if (mapped) {
      target = existing.get(mapped.candidateId) || null;
      if (!target || target.batch !== input.batch) {
        identityConflicts.push(
          identityError(record.remoteId, '已关联的候选人不存在或属于其他批次', mapped.candidateId),
        );
        continue;
      }
      if (matches.some((candidate) => candidate.id !== target!.id))
        identityConflicts.push(
          identityError(record.remoteId, '答卷身份信息命中其他候选人', target.id),
        );
    } else if (matches.length > 1) {
      identityConflicts.push(identityError(record.remoteId, '学号、电话或邮箱分别命中不同候选人'));
      continue;
    } else if (matches.length === 1) {
      target = matches[0];
      if (
        norm(record.studentId) &&
        norm(target.studentId) &&
        norm(record.studentId) !== norm(target.studentId)
      )
        identityConflicts.push(
          identityError(record.remoteId, '相同联系方式对应不同学号，需要手动核对', target.id),
        );
    }
    const id = target?.id || registrationId(input.sourceId, input.batch, record.remoteId);
    if (!target && existing.has(id))
      identityConflicts.push(identityError(record.remoteId, '新答卷编号与现有候选人冲突', id));
    const claim = claims.get(id);
    if (claim && claim !== record.remoteId)
      identityConflicts.push(identityError(record.remoteId, '多份答卷试图关联同一候选人', id));
    claims.set(id, record.remoteId);
    targets.set(record.remoteId, target);
  }
  if (identityConflicts.length)
    throw new RegistrationSyncError('报名身份信息有冲突，未应用本轮数据', identityConflicts);

  const plan: RegistrationSyncPlan = {
    additions: [],
    updates: [],
    mappings: [],
    conflicts: [],
    counts: { added: 0, updated: 0, linked: 0, unchanged: 0, skipped: 0, conflicts: 0 },
  };
  for (const record of records.values()) {
    const current = targets.get(record.remoteId) || null;
    const previous = mappings.get(record.remoteId);
    const baseline: RegistrationFields = {
      name: record.name,
      className: record.className,
      studentId: record.studentId,
      phone: record.phone,
      email: record.email,
      extra: record.extra,
    };
    if (!current) {
      // remoteId is metadata, never an additional Candidate property.
      const candidate = candidateFrom(
        baseline,
        input,
        registrationId(input.sourceId, input.batch, record.remoteId),
      );
      plan.additions.push(candidate);
      mappings.set(record.remoteId, {
        remoteId: record.remoteId,
        candidateId: candidate.id,
        baseline: structuredClone(baseline),
        ...(aliases.get(record.remoteId)?.length
          ? { duplicateRemoteIds: aliases.get(record.remoteId)! }
          : {}),
      });
      continue;
    }
    if (!previous) plan.counts.linked++;
    const after = structuredClone(current);
    const conflictingFields: string[] = [];
    let changed = false;
    const merge = (field: string, local: string | undefined, incoming: string | undefined) => {
      const baseline = field.startsWith('extra.')
        ? previous && own(previous.baseline.extra, field.slice('extra.'.length))
        : previous?.baseline[field as (typeof fields)[number]];
      if (local === incoming) return local;
      if (!previous) {
        if (local === undefined || local === '') return incoming;
        // There is no evidence that a different nonempty local value came from this source.
        if (incoming !== undefined && incoming !== '') conflictingFields.push(field);
        return local;
      }
      if (local === baseline) return incoming;
      if (incoming === baseline && !previous.pendingFields?.includes(field)) return local;
      conflictingFields.push(field);
      return local;
    };
    for (const key of fields) {
      const value = merge(key, current[key], record[key])!;
      if (value !== current[key]) {
        after[key] = value;
        changed = true;
      }
    }
    const extra = new Map(Object.entries(current.extra));
    // An absent question is not an instruction to erase an answer already collected locally.
    for (const [key, incoming] of Object.entries(record.extra)) {
      const local = own(current.extra, key);
      const value = merge('extra.' + key, local, incoming);
      if (value !== local) {
        extra.set(key, value!);
        changed = true;
      }
    }
    after.extra = Object.fromEntries(extra);
    if (conflictingFields.length)
      plan.conflicts.push({
        remoteId: record.remoteId,
        candidateId: current.id,
        kind: 'field',
        fields: conflictingFields,
        message: '报名信息与本地修改有冲突，已保留本地内容',
      });
    if (changed) {
      after.updatedAt = input.now;
      plan.updates.push({
        before: structuredClone(current),
        after: validateCandidate(after, input.config),
      });
    } else {
      plan.counts.skipped++;
      if (!conflictingFields.length) plan.counts.unchanged++;
    }
    mappings.set(record.remoteId, {
      remoteId: record.remoteId,
      candidateId: current.id,
      baseline: structuredClone(baseline),
      ...(conflictingFields.length ? { pendingFields: conflictingFields } : {}),
      ...(aliases.get(record.remoteId)?.length
        ? { duplicateRemoteIds: aliases.get(record.remoteId)! }
        : {}),
    });
  }
  if (input.candidates.length + plan.additions.length > 3000)
    throw new RegistrationSyncError('当前工作台最多保存 3000 条报名');
  plan.mappings = [...mappings.values()];
  plan.counts.added = plan.additions.length;
  plan.counts.updated = plan.updates.length;
  plan.counts.conflicts = plan.conflicts.length;
  if (duplicates) plan.counts.duplicates = duplicates;
  return plan;
}
