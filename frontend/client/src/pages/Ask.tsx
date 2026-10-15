import { useState, type FormEvent } from "react";
import { AskResult } from "@perforvisor/core";
import { Button, Card, Input, Progress, useStream } from "@perforvisor/ui";
import { RequireReport } from "../components/Empty.tsx";
import { formatDate } from "../lib/format.ts";

const suggestions = ["What do customers complain about most?", "What should I fix first?", "What do people love?", "Is delivery a problem?"];

export function Ask() {
  return <RequireReport>{({ business }) => <AskView businessKey={business.key} name={business.name} reviews={business.storedReviews} />}</RequireReport>;
}

function AskView({ businessKey, name, reviews }: { businessKey: string; name: string; reviews: number }) {
  const [question, setQuestion] = useState("");
  const stream = useStream(AskResult);
  const running = stream.status === "running";

  const ask = (q: string) => {
    setQuestion(q);
    void stream.run("/v1/ask", { question: q, entityKey: businessKey });
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim().length >= 3) ask(question.trim());
  };

  return (
    <div className="page">
      <p className="muted">
        Ask about <strong>{name}</strong>. Answers come only from its {reviews} synced reviews, with the ones used shown below.
      </p>
      <form className="input-row" onSubmit={onSubmit}>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about your reviews" aria-label="Question" />
        <Button variant="primary" type="submit" disabled={question.trim().length < 3 || running}>
          Ask
        </Button>
      </form>
      <div className="chips">
        {suggestions.map((s) => (
          <Button key={s} variant="secondary" size="sm" onClick={() => ask(s)} disabled={running}>
            {s}
          </Button>
        ))}
      </div>

      {running && <Progress percent={stream.percent} label={stream.message} />}
      {stream.status === "error" && <p className="ui-error">{stream.error}</p>}
      {stream.status === "done" && stream.result && (
        <Card>
          <div className="section-label">{stream.result.question}</div>
          <p className="verdict-text">{stream.result.answer}</p>
          {stream.result.citations.length > 0 && (
            <>
              <div className="section-label">Based on</div>
              <ul className="quotes">
                {stream.result.citations.map((c) => (
                  <li key={c.id}>
                    <span className="muted">
                      {c.rating !== undefined ? `${c.rating}★ ` : ""}
                      {c.createdAt ? `${formatDate(c.createdAt)} · ` : ""}
                    </span>
                    “{c.text}”
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
