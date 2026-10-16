import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'campus-registration-sync-'));
try {
  await build({
    entryPoints: ['lib/registration-sync.ts', 'lib/talent.ts'],
    outdir: temporary,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  const { planRegistrationSync, RegistrationSyncError } = await import(
    pathToFileURL(path.join(temporary, 'registration-sync.mjs')).href
  );
  const { DEFAULT_CONFIG, newCandidate } = await import(
    pathToFileURL(path.join(temporary, 'talent.mjs')).href
  );
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    batches: [...DEFAULT_CONFIG.batches, { id: 'another-batch', name: '另一批次' }],
  };
  const time = '2026-10-16T05:00:00.000Z';
  const later = '2026-10-16T05:05:00.000Z';
  const registration = (overrides = {}) => ({
    remoteId: 'answer-1',
    name: '林同学',
    className: '软件2401',
    studentId: 'P000000123',
    phone: '13800000001',
    email: 'student@example.com',
    extra: { 自我介绍: '希望学习 AI 应用', 每周时间: '8 小时' },
    ...overrides,
  });
  const input = (overrides = {}) => ({
    sourceId: 'qq-form-test',
    source: 'https://docs.qq.com/form/page/example',
    batch: config.batches[0].id,
    config,
    records: [registration()],
    candidates: [],
    mappings: [],
    now: time,
    ...overrides,
  });
  const firstInput = input({
    records: [
      registration({ status: '录用', notes: '不应从远端导入的评价', scores: { bogus: 10 } }),
    ],
  });
  const untouched = structuredClone(firstInput);
  const first = planRegistrationSync(firstInput);
  assert.deepEqual(firstInput, untouched, '同步规划不得修改任何输入');
  assert.equal(first.counts.added, 1);
  assert.equal(first.additions[0].status, '待面试');
  assert.equal(first.additions[0].notes, '');
  assert.deepEqual(first.additions[0].scores, {});
  assert.equal(first.additions[0].createdAt, time);
  assert.equal(first.additions[0].updatedAt, time);
  assert.equal(first.additions[0].source, firstInput.source);
  assert.equal('remoteId' in first.additions[0], false, '远端编号应单独保存，不污染候选人结构');
  assert.equal(first.mappings[0].candidateId, first.additions[0].id);
  assert.deepEqual(first, planRegistrationSync(firstInput), '相同输入应生成确定的候选人编号和规划');
  assert.notEqual(
    first.additions[0].id,
    planRegistrationSync(input({ sourceId: 'another-source' })).additions[0].id,
    '不同来源的相同远端编号不能生成同一候选人',
  );

  const synced = { candidates: first.additions, mappings: first.mappings };
  const repeated = planRegistrationSync(input({ ...synced, now: later }));
  assert.deepEqual(repeated.additions, []);
  assert.deepEqual(repeated.updates, []);
  assert.deepEqual(repeated.mappings, first.mappings);
  assert.deepEqual(
    repeated.counts,
    { added: 0, updated: 0, linked: 0, unchanged: 1, skipped: 1, conflicts: 0 },
    '重复拉取不应更新时间或候选人数据',
  );

  const interviewed = {
    ...first.additions[0],
    status: '录用',
    interviewer: '张老师',
    notes: '面试后的独立评价',
    scores: { [config.rubric[0].id]: 9 },
    source: '原始本地来源',
    demo: false,
    extra: { ...first.additions[0].extra, 本地备注问题: '面试官补充内容' },
  };
  const remoteUpdated = registration({
    className: '软件2402',
    studentId: 'P000000124',
    phone: '13800000002',
    email: 'new@example.com',
    extra: { 自我介绍: '补充了一项新项目', 每周时间: '' },
  });
  const updated = planRegistrationSync(
    input({
      candidates: [interviewed],
      mappings: first.mappings,
      records: [remoteUpdated],
      now: later,
    }),
  );
  assert.equal(updated.counts.updated, 1);
  assert.equal(updated.counts.added, 0, '远端编号已绑定时联系方式全变仍是同一个人');
  const changed = updated.updates[0].after;
  assert.equal(changed.id, interviewed.id);
  assert.equal(changed.studentId, remoteUpdated.studentId);
  assert.equal(changed.phone, remoteUpdated.phone);
  assert.equal(changed.extra.每周时间, '', '显式空值可清空未经本地修改的源字段');
  assert.equal(changed.extra.本地备注问题, '面试官补充内容');
  for (const key of [
    'status',
    'interviewer',
    'notes',
    'scores',
    'source',
    'batch',
    'direction',
    'createdAt',
    'demo',
  ])
    assert.deepEqual(changed[key], interviewed[key], `同步必须保留面试字段 ${key}`);
  assert.equal(changed.updatedAt, later);
  assert.deepEqual(updated.updates[0].before, interviewed);
  assert.deepEqual(interviewed.extra.自我介绍, '希望学习 AI 应用', '修改规划不得反向修改本地对象');

  const manuallyChanged = {
    ...interviewed,
    phone: '13900000001',
    extra: { ...interviewed.extra, 自我介绍: '面试官核实过的介绍' },
  };
  const localOnly = planRegistrationSync(
    input({ candidates: [manuallyChanged], mappings: first.mappings }),
  );
  assert.equal(localOnly.updates.length, 0, '源未变化时应保留本地修正');
  assert.equal(localOnly.conflicts.length, 0, '仅有本地变化并非双向修改冲突');
  const conflictingSource = registration({
    phone: '13800000003',
    className: '软件2403',
    extra: { 自我介绍: '报名者也修改了介绍' },
  });
  const conflict = planRegistrationSync(
    input({
      candidates: [manuallyChanged],
      mappings: first.mappings,
      records: [conflictingSource],
      now: later,
    }),
  );
  assert.equal(conflict.counts.conflicts, 1);
  assert.equal(conflict.counts.updated, 1, '其他无冲突字段仍应更新');
  assert.deepEqual(conflict.conflicts[0].fields, ['phone', 'extra.自我介绍']);
  assert.equal(conflict.updates[0].after.phone, manuallyChanged.phone);
  assert.equal(conflict.updates[0].after.className, conflictingSource.className);
  assert.equal(conflict.updates[0].after.extra.自我介绍, manuallyChanged.extra.自我介绍);
  assert.equal(conflict.updates[0].after.extra.每周时间, '8 小时', '源删除问题不删除本地旧答案');
  const stillConflicting = planRegistrationSync(
    input({
      candidates: [conflict.updates[0].after],
      mappings: conflict.mappings,
      records: [conflictingSource],
      now: later,
    }),
  );
  assert.equal(stillConflicting.updates.length, 0);
  assert.deepEqual(stillConflicting.conflicts, conflict.conflicts, '相同轮询应继续显示未解决冲突');
  const resolvedLocal = {
    ...conflict.updates[0].after,
    phone: conflictingSource.phone,
    extra: { ...conflict.updates[0].after.extra, 自我介绍: conflictingSource.extra.自我介绍 },
  };
  const resolved = planRegistrationSync(
    input({
      candidates: [resolvedLocal],
      mappings: conflict.mappings,
      records: [conflictingSource],
    }),
  );
  assert.equal(resolved.conflicts.length, 0);
  assert.equal(resolved.updates.length, 0);
  assert.equal(resolved.mappings[0].pendingFields, undefined);

  const preexisting = newCandidate(config, {
    id: 'existing-student',
    name: '林同学（已核实）',
    className: '',
    studentId: 'P000000123',
    phone: '13800000001',
    email: 'STUDENT@example.com',
    notes: '已有面试评价',
    extra: { 本地问题: '保留' },
    createdAt: time,
    updatedAt: time,
  });
  const linked = planRegistrationSync(input({ candidates: [preexisting] }));
  assert.equal(linked.counts.linked, 1);
  assert.equal(linked.additions.length, 0);
  assert.equal(linked.updates[0].after.className, '软件2401', '首次关联可填补空报名字段');
  assert.equal(linked.updates[0].after.name, preexisting.name, '首次关联不得覆盖已有不同姓名');
  assert.equal(linked.updates[0].after.notes, preexisting.notes);
  assert.equal(linked.mappings[0].candidateId, preexisting.id);
  assert.ok(linked.conflicts[0].fields.includes('name'));

  const rejected = (overrides, pattern = /冲突/) => {
    const source = input(overrides);
    const before = structuredClone(source);
    assert.throws(() => planRegistrationSync(source), pattern);
    assert.deepEqual(source, before, '失败的整轮规划不得产生输入副作用');
  };
  rejected({ records: [registration(), registration()] }, /重复远端答卷编号/);
  rejected({ records: [registration({ remoteId: '' })] }, /缺少稳定编号/);
  rejected({ records: [registration({ remoteId: undefined })] }, /缺少稳定编号/);
  rejected({ records: [registration({ remoteId: ' answer-1 ' })] }, /缺少稳定编号/);
  rejected({ records: [registration({ studentId: '2024001' })] }, /学号格式/);
  rejected({ records: [registration({ name: '' })] }, /姓名不能为空/);
  rejected({ records: [registration({ extra: { 内容: 'x'.repeat(6001) } })] }, /补充字段内容过多/);
  rejected({ candidates: [preexisting], records: [registration({ studentId: 'P000000999' })] });
  const secondStudent = {
    ...preexisting,
    id: 'second-student',
    studentId: 'P000000999',
    phone: '13800000099',
    email: 'second@example.com',
  };
  rejected({
    candidates: [preexisting, secondStudent],
    records: [registration({ phone: secondStudent.phone })],
  });
  rejected({
    candidates: [first.additions[0], secondStudent],
    mappings: first.mappings,
    records: [registration({ studentId: secondStudent.studentId, phone: '', email: '' })],
  });
  rejected({
    records: [
      registration(),
      registration({ remoteId: 'answer-2', extra: { 自我介绍: '重复提交但修改了报名内容' } }),
    ],
  });
  rejected({ candidates: [], mappings: first.mappings });
  rejected(
    { mappings: [first.mappings[0], { ...first.mappings[0], remoteId: 'answer-2' }] },
    /关联重复/,
  );
  try {
    planRegistrationSync(
      input({ candidates: [preexisting], records: [registration({ studentId: 'P000000999' })] }),
    );
    assert.fail('冲突应拒绝整轮');
  } catch (error) {
    assert.ok(error instanceof RegistrationSyncError);
    assert.equal(error.conflicts[0].kind, 'identity');
  }

  const sameName = planRegistrationSync(
    input({
      candidates: [preexisting],
      records: [registration({ studentId: '', phone: '', email: '' })],
    }),
  );
  assert.equal(sameName.additions.length, 1, '同名无身份信息时不得猜测关联');
  const anotherBatch = planRegistrationSync(
    input({ candidates: [{ ...preexisting, batch: 'another-batch' }] }),
  );
  assert.equal(anotherBatch.additions.length, 1, '不同招新批次允许相同人重新报名');
  const emptySnapshot = planRegistrationSync(input({ ...synced, records: [] }));
  assert.deepEqual(emptySnapshot.additions, []);
  assert.deepEqual(emptySnapshot.updates, []);
  assert.deepEqual(emptySnapshot.mappings, first.mappings, '源删答卷不能删除候选人或关联');

  const uniqueRegistrations = Array.from({ length: 36 }, (_, index) => index + 1)
    .filter((index) => index !== 34)
    .map((index) =>
      registration({
        remoteId: 'fr' + index,
        name: '同学' + index,
        studentId: 'P' + String(index).padStart(9, '0'),
        phone: '138' + String(index).padStart(8, '0'),
        email: 'student' + index + '@example.com',
      }),
    );
  const primaryRecord = uniqueRegistrations.find((record) => record.remoteId === 'fr31');
  const duplicateRecord = {
    ...primaryRecord,
    remoteId: 'fr34',
    name: ' ' + primaryRecord.name + ' ',
    studentId: primaryRecord.studentId.toLowerCase(),
    extra: Object.fromEntries(Object.entries(primaryRecord.extra).reverse()),
  };
  const thirtySix = [...uniqueRegistrations, duplicateRecord];
  const deduplicated = planRegistrationSync(input({ records: thirtySix }));
  assert.equal(thirtySix.length, 36);
  assert.equal(deduplicated.additions.length, 35, '36 份中一份内容完全相同，应新增 35 人');
  assert.equal(deduplicated.counts.duplicates, 1);
  const primaryMapping = deduplicated.mappings.find((mapping) => mapping.remoteId === 'fr31');
  assert.deepEqual(primaryMapping.duplicateRemoteIds, ['fr34']);
  assert.equal(
    deduplicated.mappings.some((mapping) => mapping.remoteId === 'fr34'),
    false,
  );
  const duplicateState = { candidates: deduplicated.additions, mappings: deduplicated.mappings };
  const repeatedDuplicates = planRegistrationSync(
    input({ ...duplicateState, records: thirtySix, now: later }),
  );
  assert.equal(repeatedDuplicates.additions.length, 0);
  assert.equal(repeatedDuplicates.updates.length, 0);
  assert.equal(repeatedDuplicates.counts.duplicates, 1);
  assert.deepEqual(
    repeatedDuplicates.mappings,
    deduplicated.mappings,
    '重复拉取应保留固定主 ID 和别名',
  );
  const moreDuplicates = [...thirtySix, { ...primaryRecord, remoteId: 'fr00' }];
  const newEarlierId = planRegistrationSync(input({ ...duplicateState, records: moreDuplicates }));
  const originalPrimary = newEarlierId.mappings.find((mapping) => mapping.remoteId === 'fr31');
  assert.equal(newEarlierId.additions.length, 0);
  assert.equal(newEarlierId.updates.length, 0);
  assert.equal(newEarlierId.counts.duplicates, 2);
  assert.equal(originalPrimary.candidateId, primaryMapping.candidateId);
  assert.deepEqual(
    originalPrimary.duplicateRemoteIds,
    ['fr00', 'fr34'],
    '新出现的更小 ID 只能添别名，不能换主 ID',
  );
  const missingPrimary = planRegistrationSync(
    input({
      ...duplicateState,
      records: thirtySix.filter((record) => record.remoteId !== 'fr31'),
    }),
  );
  assert.equal(missingPrimary.additions.length, 0);
  assert.equal(missingPrimary.updates.length, 0);
  assert.equal(missingPrimary.counts.duplicates, undefined, '主已删除仅余别名时本轮未折叠额外源行');
  assert.deepEqual(
    missingPrimary.mappings,
    deduplicated.mappings,
    '主答卷缺失仍应通过别名维持原主 ID',
  );
  const allMissing = planRegistrationSync(input({ ...duplicateState, records: [] }));
  assert.deepEqual(allMissing.mappings, deduplicated.mappings, '源缺失不能删除已经保存的别名');
  rejected({
    ...duplicateState,
    records: thirtySix.map((record) =>
      record.remoteId === 'fr34'
        ? { ...record, extra: { ...record.extra, 自我介绍: '现在与原答卷不同' } }
        : record,
    ),
  });
  rejected({
    ...duplicateState,
    records: thirtySix.map((record) =>
      record.remoteId === 'fr34' ? { ...record, studentId: 'P000000999' } : record,
    ),
  });
  rejected(
    {
      ...duplicateState,
      mappings: duplicateState.mappings.map((mapping) =>
        mapping.remoteId === 'fr31'
          ? { ...mapping, duplicateRemoteIds: ['fr34', 'fr31'] }
          : mapping,
      ),
    },
    /关联重复/,
  );
  const resubmittedWithoutPrimary = planRegistrationSync(
    input({
      ...synced,
      records: [registration({ remoteId: 'brand-new-identical-answer' })],
    }),
  );
  assert.equal(resubmittedWithoutPrimary.additions.length, 0);
  assert.equal(resubmittedWithoutPrimary.updates.length, 0);
  assert.equal(resubmittedWithoutPrimary.mappings[0].remoteId, 'answer-1');
  assert.deepEqual(resubmittedWithoutPrimary.mappings[0].duplicateRemoteIds, [
    'brand-new-identical-answer',
  ]);
  const noStudentId = planRegistrationSync(
    input({
      records: [
        registration({ studentId: '', phone: '', email: '' }),
        registration({ remoteId: 'without-id-2', studentId: '', phone: '', email: '' }),
      ],
    }),
  );
  assert.equal(noStudentId.additions.length, 2, '缺少学号时相同姓名和内容不能折叠成同一学生');
  assert.equal(noStudentId.counts.duplicates, undefined);

  console.log(
    '报名同步规则验证通过：稳定编号、重复幂等、完全相同答卷折叠与固定主 ID/别名、身份冲突整轮拒绝、三方合并、面试评价保护及源删除保留。',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
