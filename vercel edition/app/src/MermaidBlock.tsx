import { useEffect, useRef } from "react";
import mermaid from "mermaid";
import "./MermaidBlock.css";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
let renderCount = 0;

export default function MermaidBlock({ chart }: { chart: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const target = container.current;
    if (!target) return;

    const render = async () => {
      try {
        const { svg } = await mermaid.render(`taskflow-mermaid-${++renderCount}`, chart);
        if (!cancelled) target.innerHTML = svg;
      } catch {
        if (!cancelled) target.textContent = "تعذّر عرض مخطط Mermaid. راجع صياغة المخطط.";
      }
    };
    void render();
    return () => { cancelled = true; };
  }, [chart]);

  return <div className="mermaid-preview" ref={container} role="img" aria-label="مخطط Mermaid" />;
}
