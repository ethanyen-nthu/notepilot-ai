import katex from "katex";
import "katex/dist/katex.min.css";
export function MathText({ text }: { text: string }) {
  return (
    <div className="math-text">
      {text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g).map((part, i) => {
        const block = part.startsWith("$$");
        if (part.startsWith("$") && part.endsWith("$") && part.length > 2)
          return (
            <span
              key={i}
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(
                  part.slice(block ? 2 : 1, block ? -2 : -1),
                  {
                    displayMode: block,
                    throwOnError: false,
                    trust: false,
                    strict: "ignore",
                  },
                ),
              }}
            />
          );
        return <span key={i}>{part}</span>;
      })}
    </div>
  );
}
