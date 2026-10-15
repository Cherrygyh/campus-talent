import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
await mkdir('.sites-runtime/tests', { recursive: true });
await build({
  entryPoints: ['lib/talent.ts', 'lib/importer.ts'],
  outdir: '.sites-runtime/tests',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const model = await import(pathToFileURL(path.resolve('.sites-runtime/tests/talent.js')).href);
const importer = await import(pathToFileURL(path.resolve('.sites-runtime/tests/importer.js')).href);
const config = model.DEFAULT_CONFIG;
const a = model.newCandidate(config, {
  name: '林同学',
  studentId: 'P000000123',
  phone: '13800000001',
});
assert.equal(model.totalScore(a, config), null, '未评分不能被当作零分');
const scored = { ...a, scores: Object.fromEntries(config.rubric.map((r) => [r.id, 8])) };
assert.equal(model.totalScore(scored, config), 80);
assert.equal(
  model.findDuplicate({ ...a, studentId: 'P000000124' }, [a])?.id,
  a.id,
  '相同电话应查重',
);
assert.equal(
  model.findDuplicate({ ...a, studentId: '', phone: '' }, [a]),
  undefined,
  '同名不能合并',
);
assert.equal(model.findDuplicate({ ...a, batch: 'other' }, [a]), undefined, '不同批次可重新报名');
const csv =
  '\uFEFF姓名,班级,学号,电话,邮箱,备注\r\n林同学,软件2401,P000000123,13800000001,x@example.com,"多行\n内容，包含""引号"""';
const rows = importer.parseDelimited(csv);
assert.equal(rows[1][2], 'P000000123');
assert.equal(rows[1][5], '多行\n内容，包含"引号"');
const table = importer.tableFromRows('报名', rows);
const mapping = importer.guessMapping(table.headers);
assert.equal(mapping.name, 0);
assert.equal(mapping.studentId, 2);
const parsed = importer.rowsToCandidates(
  table,
  mapping,
  config,
  config.batches[0].id,
  '',
  '测试来源',
);
assert.equal(parsed.candidates[0].extra['备注'], '多行\n内容，包含"引号"');
assert.equal(parsed.candidates[0].studentId, 'P000000123');
assert.equal(
  importer.matchAttachment(new File([''], 'P000000123_林同学.pdf'), [
    a,
    { ...a, id: 'other', studentId: 'P000000124' },
  ]).candidateId,
  a.id,
);
assert.equal(
  importer.matchAttachment(new File([''], '林同学.pdf'), [
    a,
    { ...a, id: 'other', studentId: 'P000000124' },
  ]).candidateId,
  '',
  '同名附件必须手动核对',
);
assert.equal(model.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', '导出应防止公式注入');
assert.equal(model.safeUrl('javascript:alert(1)'), null);
assert.throws(() =>
  model.validateConfig({ ...config, rubric: [{ id: 'x', label: '表现', weight: 90 }] }),
);
assert.throws(() =>
  model.validateCandidate({ ...a, scores: { [config.rubric[0].id]: 11 } }, config),
);
const legacyConfig = {
  ...config,
  rubricTemplate: undefined,
  rubric: [
    { id: 'foundation', label: '基础能力', weight: 30 },
    { id: 'communication', label: '表达与沟通', weight: 25 },
    { id: 'motivation', label: '兴趣与意愿', weight: 25 },
    { id: 'collaboration', label: '协作与投入', weight: 20 },
  ],
};
const legacyCandidate = {
  ...a,
  scores: { foundation: 6, communication: 7, motivation: 9, collaboration: 8 },
  notes: '原始评价',
  status: '录用',
};
const legacyCopy = structuredClone(legacyConfig);
const upgraded = model.adoptInterviewRubric(legacyConfig, '2026-10-15T04:00:00Z');
assert.deepEqual(legacyConfig, legacyCopy, '采用新规则不能修改原配置对象');
assert.equal(upgraded.rubric.length, 5);
assert.equal(
  upgraded.rubric.reduce((n, r) => n + r.weight, 0),
  100,
);
assert.equal(model.totalScore(legacyCandidate, upgraded), null, '历史分数不能被误算成新维度总分');
assert.equal(model.rubricScore(legacyCandidate.scores, upgraded.rubricArchives[0].rubric), 74);
assert.deepEqual(
  model.validateCandidate(legacyCandidate, upgraded).scores,
  legacyCandidate.scores,
  '新配置必须能保留已有历史分数',
);
assert.equal(model.adoptInterviewRubric(upgraded).rubricArchives.length, 1, '重复应用不能重复归档');
const newScores = {
  ...legacyCandidate.scores,
  ...Object.fromEntries(upgraded.rubric.map((r) => [r.id, 8])),
};
assert.equal(model.totalScore({ ...legacyCandidate, scores: newScores }, upgraded), 80);
assert.equal(model.rubricScore(newScores, upgraded.rubricArchives[0].rubric), 74);
assert.ok(
  upgraded.rubric.every((r) => r.question && r.guide && r.anchors.length === 4),
  '每道考核问题需要考察重点和评分参考',
);
assert.throws(() => importer.parseDelimited('姓名,备注\n张同学,"未闭合'));
const { default: JSZip } = await import('jszip');
const zip = new JSZip();
zip.file('报名.csv', csv);
zip.file('P000000123_林同学.pdf', '%PDF-1.7\n测试');
const bytes = await zip.generateAsync({ type: 'uint8array' });
const pkg = await importer.readPackage(new File([bytes], '报名.zip'));
assert.equal(pkg.tables.length, 1);
assert.equal(pkg.files.length, 1);
const large = new JSZip();
large.file('oversized.txt', new Uint8Array(11 * 1024 * 1024));
const largeBytes = await large.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
const oversized = await importer.readPackage(new File([largeBytes], '大附件.zip'));
assert.equal(oversized.files.length, 0);
assert.equal(oversized.warnings.length, 1);
console.log(
  '核心规则验证通过：缺失评分、权重、查重、同名、CSV 引号与前导零、附件关联、ZIP 限制、导出公式防护。',
);
