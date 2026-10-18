import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { AskResult, SampleDataset, SampleSummary } from "@perforvisor/core";
import {
  Button,
  Input,
  Progress,
  ThemeToggle,
  useStream,
} from "@perforvisor/ui";

const examples: Record<SampleSummary["kind"], string[]> = {
  place: [
    "Is the butter chicken worth it?",
    "How long is the wait?",
    "Is delivery reliable?",
  ],
  product: [
    "Does it overheat?",
    "How long does the battery last?",
    "Is it durable?",
  ],
};

export function App() {
  const [subjects, setSubjects] = useState<SampleSummary[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const stream = useStream(AskResult);

  useEffect(() => {
    fetch("/v1/samples")
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)),
      )
      .then((data) => {
        const list = z.array(SampleSummary).parse(data);
        setSubjects(list);
        setSubjectId(list[0]?.id ?? null);
      })
      .catch(() =>
        setLoadError("Couldn't reach Perforvisor. Is the backend running?"),
      );
  }, []);

  const subject = subjects.find((s) => s.id === subjectId);
  const running = stream.status === "running";

  const ask = async (q: string) => {
    if (!subject || q.trim().length < 3) return;
    setQuestion(q);
    try {
      const res = await fetch(`/v1/samples/${encodeURIComponent(subject.id)}`);
      const dataset = SampleDataset.parse(await res.json());
      void stream.run("/v1/ask", {
        question: q.trim(),
        entityName: dataset.entityName,
        reviews: dataset.reviews,
      });
    } catch {
      setLoadError("Couldn't load reviews for this subject.");
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  const pick = (id: string) => {
    setSubjectId(id);
    stream.reset();
  };

  return (
    <div className="page">
      <header className="header">
        <span className="wordmark">Perforvisor</span>
        <ThemeToggle />
      </header>
      <main className="hero">
        <h1>Ask about anything people review.</h1>
        <p>
          Answers come from what real customers wrote, with the reviews to prove
          it.
        </p>

        {loadError && <p className="ui-error">{loadError}</p>}

        {subjects.length > 0 && (
          <div
            className="subjects"
            role="radiogroup"
            aria-label="What are you asking about?"
          >
            {subjects.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === subjectId}
                className="subject"
                onClick={() => pick(s.id)}
                disabled={running}
              >
                <span className="subject-name">{s.entityName}</span>
                <span className="subject-meta">
                  {s.category} · {s.reviewCount} reviews
                </span>
              </button>
            ))}
          </div>
        )}

        <form className="ask" onSubmit={onSubmit}>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              subject ? `Ask about ${subject.entityName}` : "Ask a question"
            }
            aria-label="Your question"
            disabled={!subject}
          />
          <Button
            variant="primary"
            type="submit"
            disabled={!subject || question.trim().length < 3 || running}
          >
            {running ? "Asking…" : "Ask"}
          </Button>
        </form>

        {subject && stream.status === "idle" && (
          <div className="examples">
            {examples[subject.kind].map((example) => (
              <Button
                key={example}
                variant="ghost"
                size="sm"
                className="example"
                onClick={() => void ask(example)}
              >
                {example}
              </Button>
            ))}
          </div>
        )}

        <section className="answer-area" aria-live="polite">
          {running && (
            <Progress percent={stream.percent} label={stream.message} />
          )}
          {stream.status === "error" && (
            <p className="ui-error">{stream.error}</p>
          )}
          {stream.status === "done" && stream.result && (
            <article className="answer">
              <p className="answer-text">{stream.result.answer}</p>
              {stream.result.citations.length > 0 && (
                <>
                  <div className="answer-label">
                    From {stream.result.citations.length} reviews
                  </div>
                  <ul className="quotes">
                    {stream.result.citations.map((c) => (
                      <li key={c.id}>
                        {c.rating !== undefined && (
                          <span className="stars">{c.rating}★</span>
                        )}{" "}
                        “{c.text}”
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={stream.reset}>
                Ask something else
              </Button>
            </article>
          )}
        </section>

        <p className="footnote">
          Sample data for now. Live Google Maps and Amazon lookups are coming
          soon.
        </p>
      </main>
    </div>
  );
}
