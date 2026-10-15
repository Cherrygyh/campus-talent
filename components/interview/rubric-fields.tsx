'use client';
import { Candidate, Config, RubricItem, rubricScore } from '../../lib/talent';
export function RubricGuide({ item, index }: { item: RubricItem; index: number }) {
  if (!item.question && !item.guide && !item.anchors?.length) return null;
  return (
    <div className="rubric-guide">
      {item.question && (
        <div className="rubric-question">
          <span>问题 {index + 1}</span>
          {item.question}
        </div>
      )}
      {item.guide && <p>{item.guide}</p>}
      {!!item.anchors?.length && (
        <details>
          <summary>评分参考（0–10 分）</summary>
          <ul>
            {item.anchors.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
export default function RubricFields({
  candidate,
  config,
  onChange,
}: {
  candidate: Candidate;
  config: Config;
  onChange: (scores: Candidate['scores']) => void;
}) {
  const archives = (config.rubricArchives || []).filter((a) =>
    a.rubric.some((r) => candidate.scores[r.id] != null),
  );
  return (
    <>
      <div className="rubric-list interview-rubric">
        {config.rubric.map((r, i) => (
          <section className="criterion" key={r.id}>
            <label>
              <div>
                <strong>{r.label}</strong>
                <small>权重 {r.weight}%</small>
              </div>
              <div className="score-input">
                <input
                  aria-label={r.label + '评分'}
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  placeholder="未评分"
                  value={candidate.scores[r.id] ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...candidate.scores,
                      [r.id]: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
                <span>/ 10</span>
              </div>
            </label>
            <RubricGuide item={r} index={i} />
          </section>
        ))}
      </div>
      {archives.map((a) => (
        <details className="historical-scores" key={a.id}>
          <summary>
            查看历史评分 <span>{rubricScore(candidate.scores, a.rubric) ?? '未评完'} /100</span>
          </summary>
          <p>这是调整维度前的评分，仅供参考；不折算为本次新评分。</p>
          <dl>
            {a.rubric.map((r) => (
              <div key={r.id}>
                <dt>
                  {r.label}
                  <small>权重 {r.weight}%</small>
                </dt>
                <dd>{candidate.scores[r.id] ?? '未评分'} /10</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
    </>
  );
}
