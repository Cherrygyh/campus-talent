'use client';
import { useState } from 'react';
import { Plus, Save, Trash2, Loader2, SlidersHorizontal } from 'lucide-react';
import { RubricGuide } from './rubric-fields';
import { Config, validateConfig } from '../../lib/talent';
export default function SettingsPanel({
  initial,
  onSave,
}: {
  initial: Config;
  onSave: (config: Config, expected: string) => Promise<void>;
}) {
  const [config, setConfig] = useState(() => structuredClone(initial));
  const [expected] = useState(() => JSON.stringify(initial));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setError('');
    setBusy(true);
    try {
      validateConfig(config);
      await onSave(config, expected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">按你的招新方式配置</span>
          <h2>工作台设置</h2>
          <p>报名只有基本信息也能使用；评分在面试现场填写。</p>
        </div>
        <SlidersHorizontal className="heading-icon" />
      </div>
      <section className="surface settings-section">
        <h3>工作室 / 社团</h3>
        <label>
          名称
          <input
            value={config.title}
            maxLength={80}
            onChange={(e) => setConfig({ ...config, title: e.target.value })}
          />
        </label>
      </section>
      <div className="single-setting">
        <section className="surface settings-section">
          <div className="row-between">
            <h3>招新批次</h3>
            <button
              className="text-btn"
              onClick={() =>
                setConfig({
                  ...config,
                  batches: [...config.batches, { id: crypto.randomUUID(), name: '' }],
                })
              }
            >
              <Plus size={15} />
              添加
            </button>
          </div>
          {config.batches.map((b, i) => (
            <div className="setting-row" key={b.id}>
              <input
                aria-label={'招新批次 ' + (i + 1)}
                value={b.name}
                placeholder="例如：2027 春季招新"
                maxLength={80}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    batches: config.batches.map((x) =>
                      x.id === b.id ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
              <button
                className="icon-btn"
                aria-label={'移除批次 ' + b.name}
                onClick={() =>
                  setConfig({ ...config, batches: config.batches.filter((x) => x.id !== b.id) })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <p className="helper">不同批次的报名与面试结果可分别查看。</p>
        </section>
      </div>
      <section className="surface settings-section">
        <div className="row-between">
          <h3>面试评分项</h3>
          <button
            className="text-btn"
            onClick={() =>
              setConfig({
                ...config,
                rubric: [...config.rubric, { id: crypto.randomUUID(), label: '', weight: 0 }],
              })
            }
          >
            <Plus size={15} />
            添加
          </button>
        </div>
        <p className="helper">
          每项填写 0–10 分，权重之和需为 100%。修改权重会按新规则重新计算总分。
        </p>
        {config.rubric.map((r, i) => (
          <div className="criterion-setting" key={r.id}>
            <div className="setting-row rubric-setting">
              <span className="index-dot">{i + 1}</span>
              <input
                aria-label={'评分项 ' + (i + 1)}
                value={r.label}
                maxLength={40}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    rubric: config.rubric.map((x) =>
                      x.id === r.id ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <input
                className="short-input"
                aria-label={r.label + '权重'}
                type="number"
                min={0}
                max={100}
                value={r.weight}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    rubric: config.rubric.map((x) =>
                      x.id === r.id ? { ...x, weight: Number(e.target.value) } : x,
                    ),
                  })
                }
              />
              <span>%</span>
              <button
                className="icon-btn"
                aria-label={'移除评分项 ' + r.label}
                onClick={() =>
                  setConfig({ ...config, rubric: config.rubric.filter((x) => x.id !== r.id) })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
            <RubricGuide item={r} index={i} />
          </div>
        ))}
        <div className="weight-total">
          当前权重合计：
          <strong
            className={config.rubric.reduce((s, r) => s + r.weight, 0) !== 100 ? 'error-text' : ''}
          >
            {config.rubric.reduce((s, r) => s + r.weight, 0)}%
          </strong>
        </div>
      </section>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="row-between">
        <span className="helper">已有报名或评分使用的配置项不能删除，避免丢失关联。</span>
        <button className="btn" disabled={busy} onClick={save}>
          {busy ? <Loader2 className="spin" size={17} /> : <Save size={17} />}保存设置
        </button>
      </div>
    </div>
  );
}
