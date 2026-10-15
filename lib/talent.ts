export const STATUSES = ['待面试', '面试中', '候补', '录用', '淘汰', '缺席'] as const;
export type Status = (typeof STATUSES)[number];
export type Candidate = {
  id: string;
  name: string;
  className: string;
  studentId: string;
  phone: string;
  email: string;
  direction: string;
  batch: string;
  status: Status;
  notes: string;
  interviewer: string;
  scores: Record<string, number | null>;
  extra: Record<string, string>;
  source: string;
  createdAt: string;
  updatedAt: string;
  demo?: boolean;
};
export type RubricItem = {
  id: string;
  label: string;
  weight: number;
  question?: string;
  guide?: string;
  anchors?: string[];
};
export type RubricArchive = { id: string; createdAt: string; rubric: RubricItem[] };
export type Config = {
  title: string;
  batches: { id: string; name: string }[];
  directions: { id: string; name: string; capacity: number }[];
  rubric: RubricItem[];
  rubricTemplate?: string;
  rubricArchives?: RubricArchive[];
};
export type Attachment = {
  id: string;
  candidateId: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
};
export type Audit = {
  id: string;
  time: string;
  actor: string;
  summary: string;
  undoable: boolean;
  undone?: boolean;
};
export type Snapshot = {
  revision: number;
  config: Config;
  candidates: Candidate[];
  attachments: Attachment[];
  events: Audit[];
};
export const INTERVIEW_RUBRIC: RubricItem[] = [
  {
    id: 'interview_intro',
    label: '表达与自我认知',
    weight: 20,
    question: '自我介绍',
    guide: '看能否清楚介绍经历、兴趣和长处短板，并用具体事实支撑；不按外向程度或表达风格打分。',
    anchors: [
      '0–3 分：内容零散，追问后仍难以说明自身情况。',
      '4–6 分：能介绍基本经历与兴趣，认识到部分长处或不足。',
      '7–8 分：表达有条理，有具体经历支撑，对自身有清楚认识。',
      '9–10 分：能准确概括相关经历，说明自己的选择、收获与改进。',
    ],
  },
  {
    id: 'interview_ai',
    label: 'AI 使用与实践',
    weight: 25,
    question: '接触/使用过的 AI 模型',
    guide:
      '可追问一个具体任务：为什么选这个模型、怎么提问或迭代、如何核验结果。看实践与思考，不按模型数量或是否付费打分。',
    anchors: [
      '0–3 分：仅能说出名称，无法说明用途或基本使用思路。',
      '4–6 分：知道常见用途，能说明一次基础使用或可行的尝试。',
      '7–8 分：有具体任务实例，能说明操作步骤并检查结果。',
      '9–10 分：能说明多次迭代、方法选择与局限，知道如何独立验证和改进。',
    ],
  },
  {
    id: 'interview_career',
    label: '发展目标与匹配度',
    weight: 15,
    question: '毕业方向，理想职位公司',
    guide:
      '看想探索的方向、选择理由和工作室学习之间的联系；暂未确定具体职位也可说明探索计划，不按公司名气打分。',
    anchors: [
      '0–3 分：尚未思考方向，追问后也无法说明想探索什么。',
      '4–6 分：有初步兴趣或探索方向，但与学习行动的联系较弱。',
      '7–8 分：能说明方向、理由，以及希望在工作室积累的能力。',
      '9–10 分：目标或探索路径清晰，理解相关能力要求，也愿意依据实践调整。',
    ],
  },
  {
    id: 'interview_plan',
    label: '入室规划与执行',
    weight: 25,
    question: '加入工作室后的规划',
    guide:
      '看学习目标、阶段任务、项目参与和实际行动；可追问第一个月准备做什么，以及遇到困难会如何推进。',
    anchors: [
      '0–3 分：只有笼统愿望，难以提出具体行动。',
      '4–6 分：有学习内容或参与意向，但步骤、时间安排不够明确。',
      '7–8 分：有可执行的阶段计划，能说清任务和预期产出。',
      '9–10 分：能结合自身起点拆分任务、安排反馈，并说明困难时的调整方法。',
    ],
  },
  {
    id: 'interview_commitment',
    label: '参与意愿与时间安排',
    weight: 15,
    question: '是否去其他工作室',
    guide:
      '了解是否同时面试或参加其他工作室，再确认选择理由、每周可投入时间及冲突处理。多处申请或如实说明其他选择，本身不扣分。',
    anchors: [
      '0–3 分：追问后仍无法说明参与意愿、可投入时间或冲突处理安排。',
      '4–6 分：有参与意愿，能初步说明时间，但安排仍较笼统。',
      '7–8 分：选择理由清楚，投入时间较稳定，能说明如何协调冲突。',
      '9–10 分：投入计划可持续，能主动沟通边界、协调冲突，并落实约定。',
    ],
  },
];
export const DEFAULT_CONFIG: Config = {
  title: '工作室招新',
  batches: [{ id: '2026-autumn', name: '2026 秋季招新' }],
  directions: [],
  rubric: structuredClone(INTERVIEW_RUBRIC),
  rubricTemplate: 'five-questions-v1',
};
export function rubricScore(scores: Candidate['scores'], rubric: RubricItem[]): number | null {
  if (rubric.some((r) => scores[r.id] == null)) return null;
  return (
    Math.round(rubric.reduce((s, r) => s + (Number(scores[r.id]) * r.weight) / 10, 0) * 10) / 10
  );
}
export function scoreIds(config: Config): Set<string> {
  return new Set(
    [...config.rubric, ...(config.rubricArchives || []).flatMap((a) => a.rubric)].map((r) => r.id),
  );
}
export function adoptInterviewRubric(config: Config, at = new Date().toISOString()): Config {
  if (config.rubricTemplate === 'five-questions-v1') return structuredClone(config);
  return {
    ...structuredClone(config),
    rubric: structuredClone(INTERVIEW_RUBRIC),
    rubricTemplate: 'five-questions-v1',
    rubricArchives: [
      ...(config.rubricArchives || []),
      { id: crypto.randomUUID(), createdAt: at, rubric: structuredClone(config.rubric) },
    ],
  };
}
export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
export function findDuplicate(
  c: Pick<Candidate, 'studentId' | 'phone' | 'email' | 'batch'>,
  list: Candidate[],
) {
  return list.find(
    (x) =>
      x.batch === c.batch &&
      ((norm(c.studentId) && norm(x.studentId) === norm(c.studentId)) ||
        (norm(c.phone) && norm(x.phone) === norm(c.phone)) ||
        (norm(c.email) && norm(x.email) === norm(c.email))),
  );
}
export function totalScore(c: Candidate, config: Config): number | null {
  return rubricScore(c.scores, config.rubric);
}
export function validateConfig(value: unknown): Config {
  const c = value as Config;
  if (!c || typeof c.title !== 'string' || c.title.length > 80 || !c.title.trim())
    throw new Error('请填写工作室或社团名称');
  for (const key of ['batches', 'directions', 'rubric'] as const) {
    if (!Array.isArray(c[key]) || (key !== 'directions' && !c[key].length) || c[key].length > 30)
      throw new Error('批次和评分项不能为空，且各不超过 30 项');
    if (
      new Set(c[key].map((x) => x.id)).size !== c[key].length ||
      c[key].some((x) => typeof x.id !== 'string' || !x.id || x.id.length > 80)
    )
      throw new Error('配置项编号无效或重复');
  }
  if (
    c.batches.some((x) => !x.name?.trim() || x.name.length > 80) ||
    c.directions.some(
      (x) =>
        !x.name?.trim() ||
        x.name.length > 80 ||
        !Number.isInteger(x.capacity) ||
        x.capacity < 0 ||
        x.capacity > 10000,
    )
  )
    throw new Error('请检查批次名称、方向名称和名额');
  if (
    c.rubric.some(
      (x) =>
        !x.label?.trim() ||
        x.label.length > 40 ||
        !Number.isFinite(x.weight) ||
        x.weight < 0 ||
        x.weight > 100,
    ) ||
    Math.abs(c.rubric.reduce((s, x) => s + x.weight, 0) - 100) > 0.001
  )
    throw new Error('评分权重之和必须为 100%');
  const checkItem = (r: RubricItem) =>
    (typeof r.question !== 'undefined' &&
      (typeof r.question !== 'string' || r.question.length > 300)) ||
    (typeof r.guide !== 'undefined' && (typeof r.guide !== 'string' || r.guide.length > 1500)) ||
    (typeof r.anchors !== 'undefined' &&
      (!Array.isArray(r.anchors) ||
        r.anchors.length > 10 ||
        r.anchors.some((a) => typeof a !== 'string' || a.length > 500)));
  if (c.rubric.some(checkItem)) throw new Error('评分问题或参考内容格式无效');
  if (
    c.rubricTemplate !== undefined &&
    (typeof c.rubricTemplate !== 'string' || c.rubricTemplate.length > 80)
  )
    throw new Error('评分模板标记无效');
  if (c.rubricArchives !== undefined) {
    if (!Array.isArray(c.rubricArchives) || c.rubricArchives.length > 10)
      throw new Error('历史评分规则最多保留 10 版');
    for (const a of c.rubricArchives) {
      if (
        !a ||
        typeof a.id !== 'string' ||
        !a.id ||
        typeof a.createdAt !== 'string' ||
        !Array.isArray(a.rubric) ||
        !a.rubric.length ||
        a.rubric.length > 30
      )
        throw new Error('历史评分规则格式无效');
      validateConfig({ ...c, rubric: a.rubric, rubricArchives: undefined });
    }
  }
  return structuredClone(c);
}
export function validateCandidate(value: unknown, config: Config): Candidate {
  const c = value as Candidate;
  if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id))
    throw new Error('候选人编号无效');
  if (!STATUSES.includes(c.status)) throw new Error('面试状态无效');
  if (!config.batches.some((x) => x.id === c.batch)) throw new Error('报名批次不存在');
  if (c.direction && !config.directions.some((x) => x.id === c.direction))
    throw new Error('报名方向不存在');
  for (const k of [
    'name',
    'className',
    'studentId',
    'phone',
    'email',
    'notes',
    'interviewer',
    'source',
    'createdAt',
    'updatedAt',
  ] as const) {
    if (
      typeof c[k] !== 'string' ||
      c[k].length > (k === 'notes' ? 10000 : k === 'source' ? 2000 : 200)
    )
      throw new Error(`字段 ${k} 内容无效或过长`);
  }
  if (!c.name.trim()) throw new Error('姓名不能为空');
  if (c.studentId && !/^P\d{9}$/.test(c.studentId))
    throw new Error('学号格式必须为 P 加 9 位数字，例如 P123456789');
  if (
    !c.scores ||
    typeof c.scores !== 'object' ||
    Array.isArray(c.scores) ||
    !c.extra ||
    typeof c.extra !== 'object' ||
    Array.isArray(c.extra)
  )
    throw new Error('评分或补充字段格式无效');
  if (
    Object.keys(c.extra).length > 100 ||
    Object.entries(c.extra).some(
      ([k, v]) => k.length > 120 || typeof v !== 'string' || v.length > 6000,
    )
  )
    throw new Error('补充字段内容过多');
  const allowed = scoreIds(config);
  for (const [k, v] of Object.entries(c.scores))
    if (!allowed.has(k) || (v !== null && (!Number.isFinite(v) || v < 0 || v > 10)))
      throw new Error('单项评分必须在 0 至 10 分之间');
  return structuredClone(c);
}
export function newCandidate(config: Config, data: Partial<Candidate> = {}): Candidate {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: '',
    className: '',
    studentId: '',
    phone: '',
    email: '',
    batch: config.batches[0].id,
    direction: '',
    status: '待面试',
    notes: '',
    interviewer: '',
    scores: {},
    extra: {},
    source: '手动录入',
    createdAt: now,
    updatedAt: now,
    ...data,
  };
}
export function csvCell(s: unknown) {
  let v = String(s ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(v)) v = "'" + v;
  return '"' + v.replace(/"/g, '""') + '"';
}
export function safeUrl(s: string): string | null {
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
