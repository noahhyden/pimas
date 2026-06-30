import { describe, it, expect } from "vitest";
import { createSignal } from "pimas";
import { render } from "pimas/dom";
import { renderToString } from "pimas/server";

// The whole point of the backend seam: ONE component definition, two backends.
function Card(props: { title: string; n: number }) {
  return (
    <article class="card">
      <h2>{props.title}</h2>
      <p>count: {() => props.n}</p>
    </article>
  );
}

describe("renderToString (string backend)", () => {
  it("serializes a component to HTML", () => {
    const html = renderToString(() => <Card title="Hi" n={3} />);
    expect(html).toContain('<article class="card">');
    expect(html).toContain("<h2>Hi</h2>");
    expect(html).toContain("count: 3");
    expect(html).toContain("</article>");
  });

  it("escapes text and attributes", () => {
    const html = renderToString(() => <div title={'"a" & <b>'}>{"x < y & z"}</div>);
    // In a double-quoted attribute value only & and " must be escaped (> is legal).
    expect(html).toContain('title="&quot;a&quot; &amp; &lt;b>"');
    expect(html).toContain("x &lt; y &amp; z");
  });

  it("self-closes void elements", () => {
    const html = renderToString(() => (
      <div>
        <br />
        <img src="/a.png" />
      </div>
    ));
    expect(html).toBe('<div><br><img src="/a.png"></div>');
  });

  it("the SAME component produces matching DOM and string output", () => {
    const view = () => <Card title="Same" n={7} />;

    const root = document.createElement("div");
    render(view, root);
    const domText = root.querySelector("article")!.textContent;

    const html = renderToString(view);

    // Both backends ran identical component code.
    expect(domText).toContain("Same");
    expect(domText).toContain("count: 7");
    expect(html).toContain("<h2>Same</h2>");
    expect(html).toContain("count: 7");
  });
});
